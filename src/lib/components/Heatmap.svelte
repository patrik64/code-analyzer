<script lang="ts">
	import { sequential } from '#lib/colors.js';

	interface Props {
		/** 7 rows (Sunday first, as from Date#getDay) × 24 hours. */
		matrix: number[][];
		unit?: string;
	}
	let { matrix, unit = 'commits' }: Props = $props();

	const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
	const ORDER = [1, 2, 3, 4, 5, 6, 0];
	const max = $derived(Math.max(1, ...matrix.flat()));

	function cellColor(v: number): string | null {
		if (v <= 0) return null;
		return sequential(0.1 + 0.9 * Math.sqrt(v / max));
	}
	function textColor(v: number): string {
		return v / max > 0.55 ? '#fff' : 'inherit';
	}
</script>

<div class="heatmap" role="table" aria-label="Commit activity by weekday and hour">
	<div class="corner"></div>
	{#each Array.from({ length: 24 }, (_, h) => h) as h (h)}
		<div class="hour" aria-hidden={h % 3 !== 0}>{h % 3 === 0 ? `${h}h` : ''}</div>
	{/each}
	{#each ORDER as dayIndex (dayIndex)}
		<div class="day">{DAYS[dayIndex]}</div>
		{#each matrix[dayIndex] ?? [] as v, h (h)}
			<div
				class="cell"
				style:background={cellColor(v)}
				style:color={textColor(v)}
				title="{DAYS[dayIndex]} {h}:00–{h + 1}:00 · {v} {unit}"
				role="cell"
			>
				{#if v > 0 && v / max > 0.55}<span>{v}</span>{/if}
			</div>
		{/each}
	{/each}
</div>
<div class="legend">
	<span class="muted small">0</span>
	<span class="ramp"></span>
	<span class="muted small">{max} {unit}/hour</span>
</div>

<style>
	.heatmap {
		display: grid;
		grid-template-columns: 34px repeat(24, minmax(0, 1fr));
		gap: 2px;
		font-size: 11px;
	}
	.hour {
		color: var(--muted);
		text-align: left;
		height: 14px;
		line-height: 14px;
		overflow: hidden;
	}
	.day {
		color: var(--text-2);
		line-height: 22px;
	}
	.cell {
		height: 22px;
		border-radius: 3px;
		background: var(--surface-2);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 10px;
		font-variant-numeric: tabular-nums;
	}
	.legend {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 8px;
	}
	.ramp {
		width: 120px;
		height: 8px;
		border-radius: 4px;
		background: linear-gradient(90deg, #cde2fb, #3987e5, #0d366b);
	}
</style>
