<script lang="ts">
	import { onMount } from 'svelte';
	import Chart from 'chart.js/auto';
	import type { ChartConfiguration, ChartData, ChartOptions, ChartType } from 'chart.js';
	import { theme } from '#lib/theme.svelte.js';
	import { chrome } from '#lib/colors.js';
	import { compact } from '#lib/format.js';

	interface Props {
		type: ChartType;
		data: ChartData;
		/** Chart.js options (any chart type); merged over theme-aware defaults. */
		options?: Record<string, unknown>;
		height?: number;
		/** Accessible name; also used as the caption of the data table twin. */
		title?: string;
		tableView?: boolean;
		formatValue?: (value: number) => string;
	}

	let {
		type,
		data,
		options = {},
		height = 260,
		title = 'Chart',
		tableView = true,
		formatValue = (v: number) => v.toLocaleString()
	}: Props = $props();

	let canvas = $state<HTMLCanvasElement>();
	let chart: Chart | null = null;
	let showTable = $state(false);

	const RADIAL = new Set<ChartType>(['doughnut', 'pie', 'polarArea', 'radar']);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	type AnyRecord = Record<string, any>;

	function isPlainObject(v: unknown): v is AnyRecord {
		return !!v && typeof v === 'object' && !Array.isArray(v);
	}

	function deepMerge(base: AnyRecord, override: AnyRecord): AnyRecord {
		const out: AnyRecord = { ...base };
		for (const [k, v] of Object.entries(override)) {
			out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v;
		}
		return out;
	}

	function buildOptions(dark: boolean): ChartOptions {
		const c = chrome(dark);
		const datasetCount = data.datasets.length;
		const pointBased = type === 'scatter' || type === 'bubble';
		const base: AnyRecord = {
			responsive: true,
			maintainAspectRatio: false,
			animation: { duration: 250 },
			color: c.text2,
			interaction: pointBased
				? { mode: 'nearest', intersect: false }
				: { mode: 'index', intersect: false },
			plugins: {
				legend: {
					display: datasetCount > 1,
					position: 'bottom',
					labels: { color: c.text2, boxWidth: 10, boxHeight: 10, padding: 14, font: { size: 12 } }
				},
				tooltip: {
					backgroundColor: dark ? '#2c2c2a' : '#1a1a19',
					titleColor: '#f0efec',
					bodyColor: '#f0efec',
					borderColor: dark ? '#383835' : 'transparent',
					borderWidth: dark ? 1 : 0,
					padding: 10,
					cornerRadius: 6,
					boxWidth: 8,
					boxHeight: 8,
					boxPadding: 4,
					titleFont: { weight: 600 }
				}
			}
		};
		if (!RADIAL.has(type)) {
			base.scales = {
				x: {
					grid: { color: c.grid, drawTicks: false },
					border: { color: c.axis },
					ticks: {
						color: c.muted,
						maxRotation: 0,
						autoSkip: true,
						autoSkipPadding: 12,
						font: { size: 11 },
						callback: function (this: AnyRecord, value: number | string) {
							// For category axes keep the label; for linear axes compact the number.
							const label = typeof this.getLabelForValue === 'function' ? this.getLabelForValue(Number(value)) : value;
							return typeof label === 'number' ? compact(label) : label;
						}
					}
				},
				y: {
					beginAtZero: true,
					grid: { color: c.grid, drawTicks: false },
					border: { display: false },
					ticks: {
						color: c.muted,
						font: { size: 11 },
						callback: function (this: AnyRecord, value: number | string) {
							const label = typeof this.getLabelForValue === 'function' ? this.getLabelForValue(Number(value)) : value;
							return typeof label === 'number' ? compact(label) : label;
						}
					}
				}
			};
		}
		return deepMerge(base, options as AnyRecord) as ChartOptions;
	}

	function decorate(input: ChartData, dark: boolean): ChartData {
		const c = chrome(dark);
		return {
			...input,
			datasets: input.datasets.map((ds) => {
				const d: AnyRecord = { ...ds };
				const t = d.type ?? type;
				if (t === 'bar') {
					d.maxBarThickness ??= 24;
					d.borderRadius ??= 4;
					d.borderSkipped ??= 'start';
					d.borderWidth ??= 0;
				} else if (t === 'line') {
					d.borderWidth ??= 2;
					d.tension ??= 0.3;
					d.pointRadius ??= 0;
					d.pointHoverRadius ??= 5;
					d.pointHitRadius ??= 16;
					d.pointBackgroundColor ??= d.borderColor;
					d.pointBorderColor ??= c.surface;
					d.pointBorderWidth ??= 2;
				} else if (t === 'doughnut' || t === 'pie') {
					d.borderColor ??= c.surface;
					d.borderWidth ??= 2;
					d.hoverOffset ??= 4;
				} else if (t === 'scatter' || t === 'bubble') {
					d.borderColor ??= c.surface;
					d.borderWidth ??= 1.5;
					d.pointRadius ??= 5;
					d.pointHoverRadius ??= 7;
					d.pointHitRadius ??= 14;
				}
				return d;
			})
		} as ChartData;
	}

	onMount(() => {
		if (!canvas) return;
		chart = new Chart(canvas, {
			type,
			data: decorate(data, theme.isDark),
			options: buildOptions(theme.isDark)
		} as ChartConfiguration);
		return () => {
			chart?.destroy();
			chart = null;
		};
	});

	$effect(() => {
		const dark = theme.isDark;
		const nextData = decorate(data, dark);
		const nextOptions = buildOptions(dark);
		if (chart) {
			chart.data = nextData;
			chart.options = nextOptions;
			chart.update('none');
		}
	});

	// ---- table twin ------------------------------------------------------------------------------
	const tableRows = $derived.by(() => {
		const labels = (data.labels ?? []) as (string | number)[];
		const datasets = data.datasets;
		const pointBased = datasets.some((ds) => Array.isArray(ds.data) && ds.data.some((p) => p && typeof p === 'object'));
		if (pointBased) {
			const rows: string[][] = [];
			for (const ds of datasets) {
				for (const p of ds.data as AnyRecord[]) {
					if (!p || typeof p !== 'object') continue;
					rows.push([
						String(p.label ?? ds.label ?? ''),
						formatValue(Number(p.x)),
						formatValue(Number(p.y)),
						...(p.r !== undefined ? [formatValue(Number(p.r))] : [])
					]);
				}
			}
			return { head: ['Label', 'x', 'y', ...(rows.some((r) => r.length > 3) ? ['r'] : [])], rows };
		}
		const head = ['Label', ...datasets.map((ds) => String(ds.label ?? 'Value'))];
		const rows = labels.map((label, i) => [
			String(label),
			...datasets.map((ds) => {
				const v = (ds.data as (number | null)[])[i];
				return v === null || v === undefined ? '–' : formatValue(Number(v));
			})
		]);
		return { head, rows };
	});
</script>

<div class="chart">
	<div class="chart-box" style:height="{height}px">
		<canvas bind:this={canvas} aria-label={title}></canvas>
	</div>
	{#if tableView}
		<div class="chart-foot">
			<button class="link-btn" type="button" onclick={() => (showTable = !showTable)} aria-expanded={showTable}>
				{showTable ? 'Hide data table' : 'Show data table'}
			</button>
		</div>
		{#if showTable}
			<div class="chart-table">
				<table class="data small">
					<caption class="sr-only">{title}</caption>
					<thead>
						<tr>
							{#each tableRows.head as h, i (i)}
								<th class={i > 0 ? 'num' : ''}>{h}</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each tableRows.rows as row, i (i)}
							<tr>
								{#each row as cell, j (j)}
									<td class={j > 0 ? 'num' : ''}>{cell}</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{/if}
</div>

<style>
	.chart {
		min-width: 0;
	}
	.chart-box {
		position: relative;
		width: 100%;
	}
	.chart-foot {
		display: flex;
		justify-content: flex-end;
		margin-top: 4px;
	}
	.link-btn {
		background: none;
		border: 0;
		padding: 2px 4px;
		color: var(--muted);
		font-size: 11.5px;
	}
	.link-btn:hover {
		color: var(--text);
		text-decoration: underline;
	}
	.chart-table {
		max-height: 260px;
		overflow: auto;
		margin-top: 6px;
		border: 1px solid var(--grid);
		border-radius: var(--radius-sm);
	}
	.chart-table th,
	.chart-table td {
		padding: 4px 8px;
	}
</style>
