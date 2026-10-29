<script lang="ts">
	interface Props {
		label: string;
		value: string;
		hint?: string;
		tone?: 'neutral' | 'good' | 'warn' | 'bad';
		title?: string;
	}
	let { label, value, hint, tone = 'neutral', title }: Props = $props();
</script>

<div class="tile tone-{tone}" {title}>
	<div class="label">{label}</div>
	<div class="value">{value}</div>
	{#if hint}<div class="hint">{hint}</div>{/if}
</div>

<style>
	.tile {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 12px 14px;
		min-width: 0;
		box-shadow: var(--shadow);
	}
	.label {
		font-size: 12px;
		color: var(--text-2);
		margin-bottom: 4px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.value {
		font-size: 22px;
		font-weight: 600;
		letter-spacing: -0.02em;
		line-height: 1.15;
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hint {
		font-size: 11.5px;
		color: var(--muted);
		margin-top: 4px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tone-good .value {
		color: var(--good-text);
	}
	.tone-warn .label::before,
	.tone-bad .label::before {
		content: '';
		display: inline-block;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		margin-right: 6px;
		vertical-align: 1px;
	}
	.tone-warn .label::before {
		background: var(--warning);
	}
	.tone-bad .label::before {
		background: var(--critical);
	}
</style>
