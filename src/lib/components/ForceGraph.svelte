<script lang="ts">
	import { onMount } from 'svelte';
	import {
		forceCenter,
		forceCollide,
		forceLink,
		forceManyBody,
		forceSimulation,
		forceX,
		forceY,
		type Simulation,
		type SimulationLinkDatum,
		type SimulationNodeDatum
	} from 'd3-force';
	import { select } from 'd3-selection';
	import { zoom, zoomIdentity, type ZoomTransform, type D3ZoomEvent } from 'd3-zoom';
	import { drag, type D3DragEvent } from 'd3-drag';
	import type { GraphEdge, GraphNode } from '#lib/types.js';
	import { theme } from '#lib/theme.svelte.js';
	import { chrome, series, withAlpha } from '#lib/colors.js';
	import { fmt } from '#lib/format.js';

	interface SimNode extends SimulationNodeDatum {
		id: string;
		r: number;
		data: GraphNode;
	}
	interface SimLink extends SimulationLinkDatum<SimNode> {
		weight: number;
		typeOnly: boolean;
		dynamic: boolean;
	}

	interface Props {
		nodes: GraphNode[];
		edges: GraphEdge[];
		colorOf: (node: GraphNode) => string;
		sizeBy?: 'loc' | 'inDegree' | 'uniform';
		labels?: 'auto' | 'all' | 'none';
		selectedId?: string | null;
		onSelect?: (id: string | null) => void;
		highlightQuery?: string;
		height?: number;
		showArrows?: boolean;
	}

	let {
		nodes,
		edges,
		colorOf,
		sizeBy = 'loc',
		labels = 'auto',
		selectedId = $bindable(null),
		onSelect,
		highlightQuery = '',
		height = 620,
		showArrows = true
	}: Props = $props();

	let container = $state<HTMLDivElement>();
	let canvas = $state<HTMLCanvasElement>();
	let hovered = $state<SimNode | null>(null);
	let tooltip = $state<{ x: number; y: number } | null>(null);
	let width = $state(800);
	let running = $state(false);

	let simNodes: SimNode[] = [];
	let simLinks: SimLink[] = [];
	let simulation: Simulation<SimNode, SimLink> | null = null;
	let transform: ZoomTransform = zoomIdentity;
	let frame = 0;
	let neighbours = new Map<string, Set<string>>();
	let zoomBehavior: ReturnType<typeof zoom<HTMLCanvasElement, unknown>> | null = null;
	let ready = false;

	const STATIC_THRESHOLD = 1500;

	function radiusFor(node: GraphNode): number {
		if (sizeBy === 'uniform') return 5;
		if (sizeBy === 'inDegree') return Math.min(22, 4 + Math.sqrt(node.inDegree) * 3);
		return Math.min(18, 3 + Math.sqrt(Math.max(0, node.loc)) * 0.35);
	}

	function buildSimulation() {
		const previous = new Map(simNodes.map((n) => [n.id, n]));
		simNodes = nodes.map((n) => {
			const prev = previous.get(n.id);
			return {
				id: n.id,
				r: radiusFor(n),
				data: n,
				x: prev?.x ?? width / 2 + (Math.random() - 0.5) * width * 0.8,
				y: prev?.y ?? height / 2 + (Math.random() - 0.5) * height * 0.8,
				fx: prev?.fx ?? undefined,
				fy: prev?.fy ?? undefined
			};
		});
		const byId = new Map(simNodes.map((n) => [n.id, n]));
		simLinks = edges
			.filter((e) => byId.has(e.source) && byId.has(e.target))
			.map((e) => ({
				source: e.source,
				target: e.target,
				weight: e.weight,
				typeOnly: e.typeOnly,
				dynamic: e.dynamic
			}));

		neighbours = new Map();
		for (const e of simLinks) {
			const s = e.source as string;
			const t = e.target as string;
			if (!neighbours.has(s)) neighbours.set(s, new Set());
			if (!neighbours.has(t)) neighbours.set(t, new Set());
			neighbours.get(s)!.add(t);
			neighbours.get(t)!.add(s);
		}

		simulation?.stop();
		const n = simNodes.length;
		const charge = n > 800 ? -25 : n > 200 ? -45 : -90;
		simulation = forceSimulation<SimNode, SimLink>(simNodes)
			.force(
				'link',
				forceLink<SimNode, SimLink>(simLinks)
					.id((d) => d.id)
					.distance((l) => 28 + ((l.source as SimNode).r + (l.target as SimNode).r))
					.strength(0.6)
			)
			.force('charge', forceManyBody<SimNode>().strength(charge).distanceMax(600))
			.force('center', forceCenter(width / 2, height / 2))
			.force('collide', forceCollide<SimNode>().radius((d) => d.r + 2).iterations(2))
			.force('x', forceX<SimNode>(width / 2).strength(0.04))
			.force('y', forceY<SimNode>(height / 2).strength(0.04));

		if (n > STATIC_THRESHOLD) {
			simulation.stop();
			simulation.tick(160);
			running = false;
			scheduleDraw();
			fit();
		} else {
			running = true;
			simulation.on('tick', scheduleDraw).on('end', () => {
				running = false;
				scheduleDraw();
			});
			// Fit once the layout has mostly settled.
			setTimeout(() => fit(), 900);
		}
	}

	function scheduleDraw() {
		if (frame) return;
		frame = requestAnimationFrame(() => {
			frame = 0;
			draw();
		});
	}

	function focusSet(): { focus: string | null; set: Set<string> | null } {
		const focus = hovered?.id ?? selectedId ?? null;
		if (!focus) return { focus: null, set: null };
		const set = new Set(neighbours.get(focus) ?? []);
		set.add(focus);
		return { focus, set };
	}

	function matchesQuery(node: GraphNode, q: string): boolean {
		return node.id.toLowerCase().includes(q) || node.label.toLowerCase().includes(q);
	}

	function draw() {
		if (!canvas || !ready) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		const dark = theme.isDark;
		const c = chrome(dark);
		const dpr = window.devicePixelRatio || 1;
		ctx.save();
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, width, height);
		ctx.translate(transform.x, transform.y);
		ctx.scale(transform.k, transform.k);
		const k = transform.k;

		const { focus, set } = focusSet();
		const q = highlightQuery.trim().toLowerCase();
		const outColor = series(0, dark);
		const inColor = series(1, dark);
		const ink = dark ? '#ffffff' : '#000000';
		const lineColor = withAlpha(ink, focus ? 0.05 : 0.14);
		// Arrowheads are drawn much darker than the hairline edges, otherwise they vanish into them.
		const arrowColor = withAlpha(ink, 0.55);
		// ~7px on screen when zoomed in; zoomed out, capped at 12 graph units so an overview of
		// thousands of edges does not fill up with full-size heads piling onto the hubs.
		const arrowSize = Math.min(Math.max(7 / k, 2.5), 12);
		// Thousands of heads are cheap on a settled graph but not at 60fps while the layout runs.
		const drawArrows = showArrows && !(running && simLinks.length > 3000);

		// edges
		ctx.lineWidth = 1 / k;
		for (const l of simLinks) {
			const s = l.source as SimNode;
			const t = l.target as SimNode;
			if (s.x === undefined || t.x === undefined) continue;
			let color = lineColor;
			let head = arrowColor;
			let lw = 1 / k;
			let onFocus = false;
			if (focus) {
				if (s.id === focus) {
					color = head = outColor;
					lw = 1.5 / k;
					onFocus = true;
				} else if (t.id === focus) {
					color = head = inColor;
					lw = 1.5 / k;
					onFocus = true;
				}
			}
			ctx.strokeStyle = color;
			ctx.lineWidth = lw;
			if (l.typeOnly) ctx.setLineDash([3 / k, 3 / k]);
			else ctx.setLineDash([]);
			ctx.beginPath();
			ctx.moveTo(s.x!, s.y!);
			ctx.lineTo(t.x!, t.y!);
			ctx.stroke();
			if (drawArrows && (!focus || onFocus)) {
				const dx = t.x! - s.x!;
				const dy = t.y! - s.y!;
				const len = Math.hypot(dx, dy) || 1;
				// Shrink the head to fit between dots that are close together; drop it only when it
				// would be too small to see.
				const size = Math.min(arrowSize, (len - s.r - t.r) * 0.6);
				if (size * k < 1.5) continue;
				const ux = dx / len;
				const uy = dy / len;
				// Tip sits just outside the target dot's outline ring.
				const ax = t.x! - ux * (t.r + 1 / k);
				const ay = t.y! - uy * (t.r + 1 / k);
				ctx.fillStyle = head;
				ctx.beginPath();
				ctx.moveTo(ax, ay);
				ctx.lineTo(ax - ux * size - uy * size * 0.45, ay - uy * size + ux * size * 0.45);
				ctx.lineTo(ax - ux * size + uy * size * 0.45, ay - uy * size - ux * size * 0.45);
				ctx.closePath();
				ctx.fill();
			}
		}
		ctx.setLineDash([]);

		// nodes
		const labelAll = labels === 'all';
		const autoLabels = labels === 'auto' && (k > 1.5 || simNodes.length <= 80);
		ctx.font = `${11 / k}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
		ctx.textBaseline = 'middle';
		for (const n of simNodes) {
			if (n.x === undefined || n.y === undefined) continue;
			let alpha = 1;
			if (set && !set.has(n.id)) alpha = 0.18;
			if (q && !matchesQuery(n.data, q)) alpha = Math.min(alpha, 0.12);
			ctx.globalAlpha = alpha;
			ctx.beginPath();
			ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
			ctx.fillStyle = colorOf(n.data);
			ctx.fill();
			const isSelected = n.id === selectedId;
			ctx.lineWidth = (isSelected ? 2.5 : 1.5) / k;
			ctx.strokeStyle = isSelected ? c.text : c.surface;
			ctx.stroke();
			ctx.globalAlpha = 1;
			const showLabel =
				labelAll ||
				n.id === focus ||
				(set !== null && set.has(n.id)) ||
				(autoLabels && alpha > 0.5 && (n.r >= 6 || k > 1.5)) ||
				(q !== '' && matchesQuery(n.data, q));
			if (showLabel) {
				ctx.globalAlpha = alpha < 0.5 ? 0.35 : 1;
				ctx.fillStyle = c.text;
				ctx.strokeStyle = c.surface;
				ctx.lineWidth = 3 / k;
				const text = n.data.label;
				const x = n.x + n.r + 3 / k;
				ctx.strokeText(text, x, n.y);
				ctx.fillText(text, x, n.y);
				ctx.globalAlpha = 1;
			}
		}
		ctx.restore();
	}

	function hitTest(px: number, py: number): SimNode | null {
		const [gx, gy] = transform.invert([px, py]);
		const slack = 4 / transform.k;
		let best: SimNode | null = null;
		let bestDist = Infinity;
		for (const n of simNodes) {
			if (n.x === undefined || n.y === undefined) continue;
			const d = Math.hypot(n.x - gx, n.y - gy);
			if (d <= n.r + slack && d < bestDist) {
				best = n;
				bestDist = d;
			}
		}
		return best;
	}

	function pointerPosition(event: { clientX: number; clientY: number }): [number, number] {
		const rect = canvas!.getBoundingClientRect();
		return [event.clientX - rect.left, event.clientY - rect.top];
	}

	function resizeCanvas() {
		if (!canvas || !container) return;
		width = container.clientWidth || 800;
		const dpr = window.devicePixelRatio || 1;
		canvas.width = Math.round(width * dpr);
		canvas.height = Math.round(height * dpr);
		canvas.style.width = `${width}px`;
		canvas.style.height = `${height}px`;
		simulation?.force('center', forceCenter(width / 2, height / 2));
		simulation?.force('x', forceX<SimNode>(width / 2).strength(0.04));
		scheduleDraw();
	}

	/** Zoom so that every node is visible. */
	export function fit() {
		if (!canvas || !zoomBehavior || !simNodes.length) return;
		let minX = Infinity,
			minY = Infinity,
			maxX = -Infinity,
			maxY = -Infinity;
		for (const n of simNodes) {
			if (n.x === undefined || n.y === undefined) continue;
			minX = Math.min(minX, n.x - n.r);
			maxX = Math.max(maxX, n.x + n.r);
			minY = Math.min(minY, n.y - n.r);
			maxY = Math.max(maxY, n.y + n.r);
		}
		if (!Number.isFinite(minX)) return;
		const w = Math.max(1, maxX - minX);
		const h = Math.max(1, maxY - minY);
		const k = Math.min(4, 0.9 / Math.max(w / width, h / height));
		const tx = width / 2 - k * (minX + w / 2);
		const ty = height / 2 - k * (minY + h / 2);
		select(canvas).call(zoomBehavior.transform, zoomIdentity.translate(tx, ty).scale(k));
	}

	/** Focus a node: centre and select it. */
	export function focusNode(id: string) {
		const node = simNodes.find((n) => n.id === id);
		if (!node || !canvas || !zoomBehavior || node.x === undefined || node.y === undefined) return;
		const k = Math.max(transform.k, 1.4);
		select(canvas).call(
			zoomBehavior.transform,
			zoomIdentity.translate(width / 2 - k * node.x, height / 2 - k * node.y).scale(k)
		);
	}

	export function exportPng(fileName = 'dependency-graph.png') {
		if (!canvas) return;
		const dark = theme.isDark;
		const out = document.createElement('canvas');
		out.width = canvas.width;
		out.height = canvas.height;
		const ctx = out.getContext('2d');
		if (!ctx) return;
		ctx.fillStyle = chrome(dark).surface;
		ctx.fillRect(0, 0, out.width, out.height);
		ctx.drawImage(canvas, 0, 0);
		const a = document.createElement('a');
		a.href = out.toDataURL('image/png');
		a.download = fileName;
		a.click();
	}

	export function reheat() {
		if (!simulation) return;
		for (const n of simNodes) {
			n.fx = undefined;
			n.fy = undefined;
		}
		running = true;
		simulation.alpha(0.8).restart();
	}

	onMount(() => {
		if (!canvas || !container) return;
		ready = true;
		resizeCanvas();

		zoomBehavior = zoom<HTMLCanvasElement, unknown>()
			.scaleExtent([0.08, 8])
			.filter((event: MouseEvent | WheelEvent | TouchEvent) => {
				if ((event as MouseEvent).button) return false;
				if (event.type === 'mousedown' || event.type === 'touchstart' || event.type === 'pointerdown') {
					const e = event as MouseEvent;
					const [px, py] = pointerPosition(e);
					return !hitTest(px, py);
				}
				return true;
			})
			.on('zoom', (event: D3ZoomEvent<HTMLCanvasElement, unknown>) => {
				transform = event.transform;
				scheduleDraw();
			});

		const dragBehavior = drag<HTMLCanvasElement, unknown, SimNode>()
			.subject((event) => {
				const [px, py] = pointerPosition(event.sourceEvent as MouseEvent);
				// Returning undefined tells d3-drag not to start a drag (the zoom behaviour takes over).
				return (hitTest(px, py) ?? undefined) as unknown as SimNode;
			})
			.on('start', (event: D3DragEvent<HTMLCanvasElement, unknown, SimNode>) => {
				const [px, py] = pointerPosition(event.sourceEvent as MouseEvent);
				const [gx, gy] = transform.invert([px, py]);
				event.subject.fx = gx;
				event.subject.fy = gy;
				if (simulation && simNodes.length <= STATIC_THRESHOLD) {
					running = true;
					simulation.alphaTarget(0.25).restart();
				}
			})
			.on('drag', (event: D3DragEvent<HTMLCanvasElement, unknown, SimNode>) => {
				const [px, py] = pointerPosition(event.sourceEvent as MouseEvent);
				const [gx, gy] = transform.invert([px, py]);
				event.subject.fx = gx;
				event.subject.fy = gy;
				scheduleDraw();
			})
			.on('end', (event: D3DragEvent<HTMLCanvasElement, unknown, SimNode>) => {
				if (simulation && simNodes.length <= STATIC_THRESHOLD) simulation.alphaTarget(0);
				// Keep the node pinned where it was dropped.
				event.subject.fx = event.subject.x;
				event.subject.fy = event.subject.y;
				scheduleDraw();
			});

		select(canvas).call(dragBehavior).call(zoomBehavior);

		const observer = new ResizeObserver(() => resizeCanvas());
		observer.observe(container);

		return () => {
			observer.disconnect();
			simulation?.stop();
			if (frame) cancelAnimationFrame(frame);
			ready = false;
		};
	});

	// Rebuild when the graph data changes.
	$effect(() => {
		void nodes;
		void edges;
		void sizeBy;
		if (!ready) return;
		buildSimulation();
	});

	// Redraw on visual-only changes.
	$effect(() => {
		void colorOf;
		void labels;
		void selectedId;
		void highlightQuery;
		void showArrows;
		void theme.isDark;
		scheduleDraw();
	});

	function onPointerMove(event: PointerEvent) {
		const [px, py] = pointerPosition(event);
		const hit = hitTest(px, py);
		if (hit !== hovered) {
			hovered = hit;
			scheduleDraw();
		}
		tooltip = hit ? { x: px, y: py } : null;
		if (canvas) canvas.style.cursor = hit ? 'pointer' : 'grab';
	}

	function onPointerLeave() {
		if (hovered) {
			hovered = null;
			scheduleDraw();
		}
		tooltip = null;
	}

	function onClick(event: MouseEvent) {
		const [px, py] = pointerPosition(event);
		const hit = hitTest(px, py);
		const next = hit ? hit.id : null;
		selectedId = next;
		onSelect?.(next);
		scheduleDraw();
	}
</script>

<div class="graph" bind:this={container} style:height="{height}px">
	<canvas
		bind:this={canvas}
		onpointermove={onPointerMove}
		onpointerleave={onPointerLeave}
		onclick={onClick}
		aria-label="Dependency graph of project files"
	></canvas>
	<button class="fit-btn" type="button" onclick={fit} title="Fit graph to view" aria-label="Fit graph to view">
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
			<circle cx="8" cy="8" r="2" />
		</svg>
	</button>
	{#if hovered && tooltip}
		<div
			class="tooltip"
			style:left="{Math.min(tooltip.x + 14, width - 260)}px"
			style:top="{tooltip.y + 14}px"
		>
			<div class="tt-title">{hovered.data.label}</div>
			<div class="tt-path">{hovered.data.id}</div>
			<div class="tt-meta">
				{#if hovered.data.kind === 'file'}
					<span><strong>{fmt(hovered.data.loc)}</strong> lines</span>
					<span><strong>{hovered.data.outDegree}</strong> imports</span>
					<span><strong>{hovered.data.inDegree}</strong> imported by</span>
				{:else}
					<span>external package · imported by <strong>{hovered.data.inDegree}</strong> files</span>
				{/if}
			</div>
		</div>
	{/if}
	{#if running}
		<div class="status">layout running…</div>
	{/if}
</div>

<style>
	.graph {
		position: relative;
		width: 100%;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
	}
	canvas {
		display: block;
		cursor: grab;
		touch-action: none;
	}
	.fit-btn {
		position: absolute;
		top: 10px;
		right: 10px;
		width: 30px;
		height: 30px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border-strong);
		background: var(--surface);
		color: var(--text-2);
		box-shadow: var(--shadow);
		z-index: 1;
	}
	.fit-btn:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	.fit-btn:focus-visible {
		outline: 2px solid var(--accent-soft);
		border-color: var(--accent);
	}
	.tooltip {
		position: absolute;
		pointer-events: none;
		background: #1a1a19;
		color: #f0efec;
		border-radius: 6px;
		padding: 8px 10px;
		font-size: 12px;
		max-width: 260px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
		z-index: 2;
	}
	:global(:root[data-theme='dark']) .tooltip {
		background: #2c2c2a;
		border: 1px solid #383835;
	}
	.tt-title {
		font-weight: 600;
	}
	.tt-path {
		font-family: var(--mono);
		font-size: 11px;
		opacity: 0.8;
		word-break: break-all;
		margin: 2px 0 6px;
	}
	.tt-meta {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
		opacity: 0.9;
	}
	.status {
		position: absolute;
		right: 10px;
		bottom: 8px;
		font-size: 11px;
		color: var(--muted);
		background: var(--surface);
		padding: 2px 6px;
		border-radius: 4px;
		border: 1px solid var(--border);
	}
</style>
