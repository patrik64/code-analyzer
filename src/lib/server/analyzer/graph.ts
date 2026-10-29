import type { FileInfo, GraphData, GraphEdge, GraphNode } from '#lib/types.js';

interface EdgeAccumulator {
	source: string;
	target: string;
	weight: number;
	allTypeOnly: boolean;
	allDynamic: boolean;
}

/** Build the file dependency graph from resolved imports and compute structural insights. */
export function buildGraph(files: FileInfo[]): GraphData {
	const byPath = new Map(files.map((f) => [f.path, f]));
	const edgeMap = new Map<string, EdgeAccumulator>();
	const externalEdgeMap = new Map<string, EdgeAccumulator>();
	const externalNodeMap = new Map<string, GraphNode>();
	const unresolved: GraphData['unresolved'] = [];

	for (const file of files) {
		for (const imp of file.imports) {
			if (imp.target === 'internal' && imp.resolved && byPath.has(imp.resolved)) {
				if (imp.resolved === file.path) continue;
				const key = `${file.path}\u0000${imp.resolved}`;
				const acc = edgeMap.get(key);
				if (acc) {
					acc.weight++;
					acc.allTypeOnly &&= imp.typeOnly;
					acc.allDynamic &&= imp.kind === 'dynamic';
				} else {
					edgeMap.set(key, {
						source: file.path,
						target: imp.resolved,
						weight: 1,
						allTypeOnly: imp.typeOnly,
						allDynamic: imp.kind === 'dynamic'
					});
				}
			} else if (imp.target === 'external' && imp.packageName) {
				const id = `pkg:${imp.packageName}`;
				if (!externalNodeMap.has(id)) {
					externalNodeMap.set(id, {
						id,
						label: imp.packageName,
						dir: '',
						language: 'external',
						loc: 0,
						inDegree: 0,
						outDegree: 0,
						kind: 'external',
						isTest: false
					});
				}
				const key = `${file.path}\u0000${id}`;
				const acc = externalEdgeMap.get(key);
				if (acc) {
					acc.weight++;
					acc.allTypeOnly &&= imp.typeOnly;
					acc.allDynamic &&= imp.kind === 'dynamic';
				} else {
					externalEdgeMap.set(key, {
						source: file.path,
						target: id,
						weight: 1,
						allTypeOnly: imp.typeOnly,
						allDynamic: imp.kind === 'dynamic'
					});
				}
			} else if (imp.target === 'unresolved') {
				if (unresolved.length < 500) {
					unresolved.push({ from: file.path, source: imp.source, line: imp.line });
				}
			}
		}
	}

	const edges: GraphEdge[] = [...edgeMap.values()].map((e) => ({
		source: e.source,
		target: e.target,
		weight: e.weight,
		typeOnly: e.allTypeOnly,
		dynamic: e.allDynamic
	}));

	const inDegree = new Map<string, number>();
	const outDegree = new Map<string, number>();
	for (const e of edges) {
		inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
		outDegree.set(e.source, (outDegree.get(e.source) ?? 0) + 1);
	}
	for (const file of files) {
		file.importedBy = inDegree.get(file.path) ?? 0;
		file.dependsOn = outDegree.get(file.path) ?? 0;
	}

	const nodes: GraphNode[] = files.map((f) => ({
		id: f.path,
		label: /^index\.[cm]?[jt]sx?$/.test(f.name) && f.dir ? `${f.dir.slice(f.dir.lastIndexOf('/') + 1)}/${f.name}` : f.name,
		dir: f.dir,
		language: f.language,
		loc: f.loc,
		inDegree: f.importedBy,
		outDegree: f.dependsOn,
		kind: 'file',
		isTest: f.isTest
	}));

	const externalEdges: GraphEdge[] = [...externalEdgeMap.values()].map((e) => ({
		source: e.source,
		target: e.target,
		weight: e.weight,
		typeOnly: e.allTypeOnly,
		dynamic: e.allDynamic
	}));
	for (const e of externalEdges) {
		const node = externalNodeMap.get(e.target);
		if (node) node.inDegree++;
	}

	// Cycles: strongly connected components over value-level (non type-only) imports.
	const adjacency = new Map<string, string[]>();
	for (const e of edges) {
		if (e.typeOnly) continue;
		let list = adjacency.get(e.source);
		if (!list) adjacency.set(e.source, (list = []));
		list.push(e.target);
	}
	const cycles = stronglyConnectedComponents(
		files.map((f) => f.path),
		adjacency
	)
		.filter((c) => c.length > 1)
		.sort((a, b) => b.length - a.length)
		.slice(0, 100)
		.map((c) => c.sort());

	const orphans = files
		.filter((f) => f.importedBy === 0 && f.dependsOn === 0)
		.map((f) => f.path);
	const entryPoints = files
		.filter((f) => f.importedBy === 0 && f.dependsOn > 0 && !f.isTest && !f.isDeclaration)
		.sort((a, b) => b.dependsOn - a.dependsOn)
		.map((f) => f.path);

	const hubs = [...files]
		.filter((f) => f.importedBy > 0)
		.sort((a, b) => b.importedBy - a.importedBy || a.path.localeCompare(b.path))
		.slice(0, 25)
		.map((f) => ({ path: f.path, inDegree: f.importedBy }));

	const fanOut = [...files]
		.filter((f) => f.dependsOn > 0)
		.sort((a, b) => b.dependsOn - a.dependsOn || a.path.localeCompare(b.path))
		.slice(0, 25)
		.map((f) => ({ path: f.path, outDegree: f.dependsOn }));

	return {
		nodes,
		edges,
		externalNodes: [...externalNodeMap.values()].sort((a, b) => b.inDegree - a.inDegree),
		externalEdges,
		cycles,
		orphans,
		entryPoints,
		hubs,
		unresolved,
		fanOut
	};
}

/** Iterative Tarjan SCC (no recursion so deep import chains cannot overflow the stack). */
export function stronglyConnectedComponents(
	vertices: string[],
	adjacency: Map<string, string[]>
): string[][] {
	const index = new Map<string, number>();
	const lowlink = new Map<string, number>();
	const onStack = new Set<string>();
	const stack: string[] = [];
	const components: string[][] = [];
	let counter = 0;

	for (const start of vertices) {
		if (index.has(start)) continue;
		const work: { v: string; i: number }[] = [{ v: start, i: 0 }];
		index.set(start, counter);
		lowlink.set(start, counter);
		counter++;
		stack.push(start);
		onStack.add(start);

		while (work.length) {
			const frame = work[work.length - 1];
			const neighbours = adjacency.get(frame.v) ?? [];
			if (frame.i < neighbours.length) {
				const w = neighbours[frame.i++];
				if (!index.has(w)) {
					index.set(w, counter);
					lowlink.set(w, counter);
					counter++;
					stack.push(w);
					onStack.add(w);
					work.push({ v: w, i: 0 });
				} else if (onStack.has(w)) {
					lowlink.set(frame.v, Math.min(lowlink.get(frame.v)!, index.get(w)!));
				}
			} else {
				work.pop();
				if (work.length) {
					const parent = work[work.length - 1].v;
					lowlink.set(parent, Math.min(lowlink.get(parent)!, lowlink.get(frame.v)!));
				}
				if (lowlink.get(frame.v) === index.get(frame.v)) {
					const component: string[] = [];
					let w: string;
					do {
						w = stack.pop()!;
						onStack.delete(w);
						component.push(w);
					} while (w !== frame.v);
					components.push(component);
				}
			}
		}
	}
	return components;
}
