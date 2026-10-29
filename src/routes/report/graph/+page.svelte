<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import type { PageProps } from './$types';
	import type { GraphNode } from '#lib/types.js';
	import ForceGraph from '#lib/components/ForceGraph.svelte';
	import { theme } from '#lib/theme.svelte.js';
	import { LANGUAGE_LABEL, LANGUAGE_ORDER, OTHER_COLOR, languageColor, series } from '#lib/colors.js';
	import { fmt, reportHref, shortPath } from '#lib/format.js';
	import { buildGrouping } from '#lib/groups.js';

	let { data }: PageProps = $props();
	const a = $derived(data.analysis);
	const dark = $derived(theme.isDark);

	let colorBy = $state<'directory' | 'language'>('directory');
	let groupDepth = $state<'auto' | '1' | '2' | '3'>('auto');
	let sizeBy = $state<'loc' | 'inDegree' | 'uniform'>('loc');
	let labels = $state<'auto' | 'all' | 'none'>('auto');
	let showExternal = $state(false);
	let hideTests = $state(false);
	let hideTypeOnly = $state(false);
	// Projects with many unconnected files (fixtures, scripts) are easier to read without them.
	// svelte-ignore state_referenced_locally
	let hideOrphans = $state(data.analysis.graph.orphans.length > data.analysis.graph.nodes.length * 0.3);
	let showArrows = $state(true);
	let query = $state('');
	let selectedId = $state<string | null>(page.url.searchParams.get('node'));
	let graph = $state<ForceGraph>();

	const grouping = $derived(
		buildGrouping(
			a.graph.nodes.map((n) => n.id),
			groupDepth === 'auto' ? 'auto' : Number(groupDepth)
		)
	);
	const fileNodes = $derived(
		a.graph.nodes.filter(
			(n) => !(hideTests && n.isTest) && !(hideOrphans && n.inDegree === 0 && n.outDegree === 0)
		)
	);
	const nodes = $derived(showExternal ? [...fileNodes, ...a.graph.externalNodes] : fileNodes);
	const nodeIds = $derived(new Set(nodes.map((n) => n.id)));
	const edges = $derived(
		[...a.graph.edges, ...(showExternal ? a.graph.externalEdges : [])].filter(
			(e) => nodeIds.has(e.source) && nodeIds.has(e.target) && !(hideTypeOnly && e.typeOnly)
		)
	);

	const colorOf = $derived((node: GraphNode) =>
		node.kind === 'external'
			? OTHER_COLOR
			: colorBy === 'language'
				? languageColor(node.language, dark)
				: grouping.colorOf(node.id, dark)
	);

	const usedLanguages = $derived(LANGUAGE_ORDER.filter((l) => a.summary.byLanguage[l].files > 0));

	const selected = $derived(selectedId ? a.files.find((f) => f.path === selectedId) ?? null : null);
	const selectedExternal = $derived(
		selectedId && selectedId.startsWith('pkg:') ? a.externals.find((e) => `pkg:${e.name}` === selectedId) ?? null : null
	);
	const importsOf = $derived(
		selected ? a.graph.edges.filter((e) => e.source === selected.path).map((e) => e.target).sort() : []
	);
	const importedBy = $derived(
		selected ? a.graph.edges.filter((e) => e.target === selected.path).map((e) => e.source).sort() : []
	);

	function focus(id: string) {
		selectedId = id;
		graph?.focusNode(id);
	}

	onMount(() => {
		if (selectedId) {
			const id = selectedId;
			const t = setTimeout(() => graph?.focusNode(id), 1300);
			return () => clearTimeout(t);
		}
	});
</script>

<div class="stack">
	<section class="card controls">
		<div class="toolbar">
			<input class="input search" type="search" placeholder="Highlight files matching…" bind:value={query} aria-label="Highlight files matching" />
			<label>
				Colour
				<select class="input" bind:value={colorBy}>
					<option value="directory">folder</option>
					<option value="language">language</option>
				</select>
			</label>
			{#if colorBy === 'directory'}
				<label>
					Depth
					<select class="input" bind:value={groupDepth}>
						<option value="auto">auto ({grouping.depth})</option>
						<option value="1">1</option>
						<option value="2">2</option>
						<option value="3">3</option>
					</select>
				</label>
			{/if}
			<label>
				Size
				<select class="input" bind:value={sizeBy}>
					<option value="loc">lines of code</option>
					<option value="inDegree">imported by</option>
					<option value="uniform">uniform</option>
				</select>
			</label>
			<label>
				Labels
				<select class="input" bind:value={labels}>
					<option value="auto">auto</option>
					<option value="all">all</option>
					<option value="none">none</option>
				</select>
			</label>
			<label><input type="checkbox" bind:checked={showExternal} /> external packages</label>
			<label><input type="checkbox" bind:checked={hideTests} /> hide tests</label>
			<label><input type="checkbox" bind:checked={hideOrphans} /> hide orphans</label>
			<label><input type="checkbox" bind:checked={hideTypeOnly} /> hide type-only</label>
			<label><input type="checkbox" bind:checked={showArrows} /> arrows</label>
			<span class="spacer"></span>
			<button class="btn" type="button" onclick={() => graph?.fit()}>Fit</button>
			<button class="btn" type="button" onclick={() => graph?.reheat()} title="Unpin nodes and run the layout again">Re-layout</button>
			<button class="btn" type="button" onclick={() => graph?.exportPng(`${a.name}-import-graph.png`)}>Export PNG</button>
		</div>
		<div class="legend row small">
			{#if colorBy === 'directory'}
				{#each grouping.groups as g (g.key)}
					<span class="badge"><span class="dot" style:background={g.slot === null ? OTHER_COLOR : series(g.slot, dark)}></span>{g.label} <span class="muted">{g.files}</span></span>
				{/each}
			{:else}
				{#each usedLanguages as l (l)}
					<span class="badge"><span class="dot" style:background={languageColor(l, dark)}></span>{LANGUAGE_LABEL[l]} <span class="muted">{a.summary.byLanguage[l].files}</span></span>
				{/each}
			{/if}
			{#if showExternal}<span class="badge"><span class="dot" style:background={OTHER_COLOR}></span>external package</span>{/if}
			<span class="muted">· {fmt(nodes.length)} nodes · {fmt(edges.length)} edges · dashed = type-only · hover to trace: <span style:color={series(0, dark)}>■</span> imports, <span style:color={series(1, dark)}>■</span> imported by</span>
		</div>
	</section>

	<section class="graph-layout">
		<div class="graph-area">
			<ForceGraph
				bind:this={graph}
				{nodes}
				{edges}
				{colorOf}
				{sizeBy}
				{labels}
				{showArrows}
				highlightQuery={query}
				bind:selectedId
				height={640}
			/>
		</div>
		<aside class="card side">
			{#if selected}
				<h2 class="side-title" title={selected.path}>{selected.name}</h2>
				<div class="mono small text-2 wrap">{selected.path}</div>
				<dl class="facts">
					<dt>Language</dt><dd>{LANGUAGE_LABEL[selected.language]}</dd>
					<dt>Lines</dt><dd>{fmt(selected.loc)} <span class="muted">({fmt(selected.sloc)} code)</span></dd>
					<dt>Functions</dt><dd>{selected.functionCount}</dd>
					<dt>Complexity</dt><dd>{selected.complexity}</dd>
					<dt>Exports</dt><dd>{selected.exportCount}</dd>
					{#if selected.git}<dt>Commits</dt><dd>{selected.git.commits} · {selected.git.authors} author{selected.git.authors === 1 ? '' : 's'}</dd>{/if}
				</dl>
				<p class="small"><a href={reportHref('files', a.path, { q: selected.path })}>Open in Files →</a></p>
				<h3>Imports ({importsOf.length})</h3>
				{#if importsOf.length}
					<ul class="list compact">
						{#each importsOf as p (p)}
							<li><button class="link path" type="button" onclick={() => focus(p)} title={p}>{shortPath(p, 40)}</button></li>
						{/each}
					</ul>
				{:else}<p class="muted small">No internal imports.</p>{/if}
				<h3>Imported by ({importedBy.length})</h3>
				{#if importedBy.length}
					<ul class="list compact">
						{#each importedBy as p (p)}
							<li><button class="link path" type="button" onclick={() => focus(p)} title={p}>{shortPath(p, 40)}</button></li>
						{/each}
					</ul>
				{:else}<p class="muted small">Nothing imports this file.</p>{/if}
			{:else if selectedExternal}
				<h2 class="side-title">{selectedExternal.name}</h2>
				<p class="small text-2">External package{selectedExternal.declared ? ` · ${selectedExternal.declared}` : ' · not declared in package.json'}{selectedExternal.declaredVersion ? ` · ${selectedExternal.declaredVersion}` : ''}</p>
				<h3>Imported by ({selectedExternal.files.length})</h3>
				<ul class="list compact">
					{#each selectedExternal.files as p (p)}
						<li><button class="link path" type="button" onclick={() => focus(p)} title={p}>{shortPath(p, 40)}</button></li>
					{/each}
				</ul>
			{:else}
				<h2 class="side-title">Import graph</h2>
				<p class="small text-2">Each dot is a file; an arrow points from the importing file to the file it imports. Drag to pan, scroll to zoom, drag a dot to pin it, click a dot for details.</p>
				<h3>Hubs <span class="muted">most imported</span></h3>
				<ul class="list compact">
					{#each a.graph.hubs.slice(0, 10) as h (h.path)}
						<li><button class="link path" type="button" onclick={() => focus(h.path)} title={h.path}>{shortPath(h.path, 36)}</button><span class="num muted">{h.inDegree}</span></li>
					{/each}
				</ul>
				<h3>Widest fan-out <span class="muted">most imports</span></h3>
				<ul class="list compact">
					{#each a.graph.fanOut.slice(0, 6) as h (h.path)}
						<li><button class="link path" type="button" onclick={() => focus(h.path)} title={h.path}>{shortPath(h.path, 36)}</button><span class="num muted">{h.outDegree}</span></li>
					{/each}
				</ul>
			{/if}
		</aside>
	</section>

	<section class="grid grid-3">
		<div class="card">
			<div class="card-head"><h2>Circular dependencies</h2><p>{a.graph.cycles.length} group{a.graph.cycles.length === 1 ? '' : 's'}</p></div>
			{#if a.graph.cycles.length}
				<p class="small text-2">Files in each group import each other (directly or through other members). Type-only imports are ignored because TypeScript erases them.</p>
				<div class="cycles">
					{#each a.graph.cycles as cycle, i (i)}
						<div class="cycle">
							<div class="small muted">{cycle.length} files</div>
							<ul class="list compact">
								{#each cycle as p (p)}
									<li><button class="link path" type="button" onclick={() => focus(p)} title={p}>{shortPath(p, 48)}</button></li>
								{/each}
							</ul>
						</div>
					{/each}
				</div>
			{:else}
				<p class="muted small">No circular dependencies between files.</p>
			{/if}
		</div>
		<div class="card">
			<div class="card-head"><h2>Entry points</h2><p>{a.graph.entryPoints.length} files import others but are never imported</p></div>
			<ul class="list compact scroll-list">
				{#each a.graph.entryPoints.slice(0, 60) as p (p)}
					<li><button class="link path" type="button" onclick={() => focus(p)} title={p}>{shortPath(p, 52)}</button></li>
				{/each}
			</ul>
			<div class="card-head" style:margin-top="14px"><h2>Orphans</h2><p>{a.graph.orphans.length} files with no imports either way</p></div>
			{#if a.graph.orphans.length}
				<ul class="list compact scroll-list">
					{#each a.graph.orphans.slice(0, 60) as p (p)}
						<li><button class="link path" type="button" onclick={() => focus(p)} title={p}>{shortPath(p, 52)}</button></li>
					{/each}
				</ul>
			{:else}
				<p class="muted small">None.</p>
			{/if}
		</div>
		<div class="card">
			<div class="card-head"><h2>Unresolved imports</h2><p>{a.graph.unresolved.length} relative imports without a matching file</p></div>
			{#if a.graph.unresolved.length}
				<p class="small text-2">Usually build output (<code>dist/</code>), generated code, or genuinely broken paths.</p>
				<ul class="list compact scroll-list">
					{#each a.graph.unresolved.slice(0, 100) as u, i (i)}
						<li>
							<span class="path"><button class="link path" type="button" onclick={() => focus(u.from)} title={u.from}>{shortPath(u.from, 34)}</button><span class="muted">:{u.line}</span> → <code>{u.source}</code></span>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="muted small">Every relative import resolved to a file.</p>
			{/if}
		</div>
	</section>
</div>

<style>
	.controls {
		padding: 12px 16px;
	}
	.controls .toolbar {
		margin-bottom: 8px;
	}
	.search {
		min-width: 200px;
	}
	.spacer {
		flex: 1;
	}
	.legend {
		gap: 6px;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		display: inline-block;
	}
	.graph-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 300px;
		gap: 16px;
		align-items: start;
	}
	.side {
		max-height: 640px;
		overflow: auto;
		padding: 16px;
	}
	.side-title {
		word-break: break-all;
	}
	.side h3 {
		margin: 14px 0 6px;
	}
	.wrap {
		word-break: break-all;
		margin: 4px 0 8px;
	}
	.facts {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 3px 12px;
		margin: 0 0 8px;
		font-size: 13px;
	}
	.facts dt {
		color: var(--muted);
	}
	.facts dd {
		margin: 0;
	}
	.link {
		background: none;
		border: 0;
		padding: 0;
		color: var(--text);
		text-align: left;
		font: inherit;
	}
	.link.path {
		font-family: var(--mono);
		font-size: 12px;
	}
	.link:hover {
		color: var(--accent);
		text-decoration: underline;
	}
	.list.compact li {
		padding: 3px 0;
	}
	.scroll-list {
		max-height: 260px;
		overflow: auto;
	}
	.cycles {
		display: flex;
		flex-direction: column;
		gap: 10px;
		max-height: 420px;
		overflow: auto;
		margin-top: 8px;
	}
	.cycle {
		border: 1px solid var(--grid);
		border-radius: var(--radius-sm);
		padding: 8px 10px;
	}
	@media (max-width: 1000px) {
		.graph-layout {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
