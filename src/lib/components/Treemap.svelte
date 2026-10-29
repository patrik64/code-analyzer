<script lang="ts">
	import { hierarchy, treemap, treemapSquarify, type HierarchyRectangularNode } from 'd3-hierarchy';
	import type { TreeNode } from '#lib/types.js';
	import { fmt } from '#lib/format.js';

	interface Props {
		tree: TreeNode;
		/** Colour for a file (leaf) path. */
		colorOf: (path: string) => string;
		height?: number;
		onSelect?: (node: TreeNode) => void;
		maxLeaves?: number;
	}

	let { tree, colorOf, height = 380, onSelect, maxLeaves = 1200 }: Props = $props();

	let width = $state(900);
	let hoveredPath = $state<string | null>(null);

	/** Collapse deep directories into aggregate leaves so the map stays readable. */
	function prune(root: TreeNode): TreeNode {
		const countLeaves = (n: TreeNode): number =>
			n.children ? n.children.reduce((s, c) => s + countLeaves(c), 0) : 1;
		let depthLimit = 8;
		let result = root;
		while (depthLimit >= 1) {
			result = limit(root, 0, depthLimit);
			if (countLeaves(result) <= maxLeaves) break;
			depthLimit--;
		}
		return result;
	}

	function limit(node: TreeNode, depth: number, max: number): TreeNode {
		if (!node.children) return node;
		if (depth >= max) {
			return { name: `${node.name}/`, path: node.path, loc: node.loc, children: undefined };
		}
		return { ...node, children: node.children.map((c) => limit(c, depth + 1, max)) };
	}

	const layout = $derived.by(() => {
		const pruned = prune(tree);
		const root = hierarchy<TreeNode>(pruned, (d) => d.children)
			.sum((d) => (d.children ? 0 : d.loc))
			.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
		treemap<TreeNode>()
			.tile(treemapSquarify)
			.size([width, height])
			.paddingInner(2)
			.paddingOuter(3)
			.paddingTop((d) => (d.depth === 1 && d.children ? 18 : 3))
			.round(true)(root);
		return root as HierarchyRectangularNode<TreeNode>;
	});

	const leaves = $derived(layout.leaves().filter((d) => d.x1 - d.x0 > 0 && d.y1 - d.y0 > 0));
	const dirs = $derived(layout.descendants().filter((d) => d.depth === 1 && d.children));

	function labelFor(d: HierarchyRectangularNode<TreeNode>): string | null {
		const w = d.x1 - d.x0;
		const h = d.y1 - d.y0;
		if (w < 42 || h < 16) return null;
		const chars = Math.floor((w - 8) / 6.4);
		const name = d.data.name;
		return name.length > chars ? (chars > 3 ? name.slice(0, chars - 1) + '…' : null) : name;
	}

	function resize(node: HTMLDivElement) {
		const observer = new ResizeObserver(() => {
			width = node.clientWidth || 900;
		});
		observer.observe(node);
		width = node.clientWidth || 900;
		return { destroy: () => observer.disconnect() };
	}
</script>

<div class="treemap" use:resize style:height="{height}px">
	<svg {width} {height} role="img" aria-label="Treemap of lines of code per file, grouped by directory">
		{#each dirs as d (d.data.path)}
			<g>
				<rect x={d.x0} y={d.y0} width={d.x1 - d.x0} height={d.y1 - d.y0} class="dir" rx="3" />
				{#if d.x1 - d.x0 > 50}
					<text x={d.x0 + 5} y={d.y0 + 12} class="dir-label">
						{d.data.name} · {fmt(d.value ?? 0)}
					</text>
				{/if}
			</g>
		{/each}
		{#each leaves as d (d.data.path)}
			{@const label = labelFor(d)}
			<g
				class="leaf"
				class:dim={hoveredPath !== null && hoveredPath !== d.data.path}
				role="button"
				tabindex="-1"
				onpointerenter={() => (hoveredPath = d.data.path)}
				onpointerleave={() => (hoveredPath = null)}
				onclick={() => onSelect?.(d.data)}
				onkeydown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') onSelect?.(d.data);
				}}
			>
				<title>{d.data.path} · {fmt(d.data.loc)} lines</title>
				<rect
					x={d.x0}
					y={d.y0}
					width={d.x1 - d.x0}
					height={d.y1 - d.y0}
					fill={colorOf(d.data.path)}
					rx="2"
				/>
				{#if label}
					<text x={d.x0 + 4} y={d.y0 + 12} class="leaf-label">{label}</text>
				{/if}
			</g>
		{/each}
	</svg>
</div>

<style>
	.treemap {
		width: 100%;
		min-width: 0;
		overflow: hidden;
	}
	svg {
		display: block;
	}
	.dir {
		fill: var(--surface-2);
		stroke: var(--grid);
		stroke-width: 1;
	}
	.dir-label {
		font-size: 11px;
		fill: var(--text-2);
		font-weight: 600;
	}
	.leaf {
		cursor: pointer;
	}
	.leaf rect {
		opacity: 0.86;
		transition: opacity 120ms;
	}
	.leaf:hover rect {
		opacity: 1;
	}
	.leaf.dim rect {
		opacity: 0.45;
	}
	.leaf-label {
		font-size: 10.5px;
		fill: #fff;
		pointer-events: none;
		paint-order: stroke;
		stroke: rgba(0, 0, 0, 0.35);
		stroke-width: 2px;
	}
</style>
