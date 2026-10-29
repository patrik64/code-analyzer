<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
	import { cellText, compareValues, rawValue, type Column } from '#lib/table.js';

	interface Props {
		rows: T[];
		columns: Column<T>[];
		rowKey: (row: T) => string;
		sortKey?: string;
		sortDir?: 'asc' | 'desc';
		pageSize?: number;
		searchable?: boolean;
		searchPlaceholder?: string;
		filter?: (row: T, query: string) => boolean;
		selectedKey?: string | null;
		onRowClick?: (row: T) => void;
		/** Rendered under a row when it is expanded (click toggles). */
		expand?: Snippet<[T]>;
		/** Custom cell rendering; fall back to `cellText` for columns you do not handle. */
		cell?: Snippet<[T, Column<T>]>;
		/** Extra controls rendered in the toolbar. */
		toolbar?: Snippet;
		empty?: string;
		maxHeight?: number | null;
		/** Current filter text (bindable so a parent can seed or read it). */
		query?: string;
	}

	let {
		rows,
		columns,
		rowKey,
		sortKey = $bindable(''),
		sortDir = $bindable<'asc' | 'desc'>('desc'),
		pageSize = 50,
		searchable = false,
		searchPlaceholder = 'Filter…',
		filter,
		selectedKey = null,
		onRowClick,
		expand,
		cell,
		toolbar,
		empty = 'Nothing to show.',
		maxHeight = null,
		query = $bindable('')
	}: Props = $props();

	let page = $state(0);
	// svelte-ignore state_referenced_locally
	let size = $state(pageSize);
	let expanded = $state(new Set<string>());

	const normalizedQuery = $derived(query.trim().toLowerCase());

	const filtered = $derived.by(() => {
		if (!normalizedQuery) return rows;
		if (filter) return rows.filter((r) => filter(r, normalizedQuery));
		return rows.filter((r) => columns.some((c) => cellText(r, c).toLowerCase().includes(normalizedQuery)));
	});

	const sorted = $derived.by(() => {
		const col = columns.find((c) => c.key === sortKey);
		if (!col) return filtered;
		const dir = sortDir === 'asc' ? 1 : -1;
		return [...filtered].sort((a, b) => dir * compareValues(rawValue(a, col), rawValue(b, col)));
	});

	const pageCount = $derived(size > 0 ? Math.max(1, Math.ceil(sorted.length / size)) : 1);
	const current = $derived(Math.min(page, pageCount - 1));
	const visible = $derived(size > 0 ? sorted.slice(current * size, current * size + size) : sorted);

	$effect(() => {
		// Reset to the first page whenever the query or sort changes.
		void normalizedQuery;
		void sortKey;
		void sortDir;
		page = 0;
	});

	function toggleSort(col: Column<T>) {
		if (col.sortable === false) return;
		if (sortKey === col.key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		else {
			sortKey = col.key;
			sortDir = col.align === 'right' ? 'desc' : 'asc';
		}
	}

	function clickRow(row: T) {
		if (expand) {
			const key = rowKey(row);
			const next = new Set(expanded);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			expanded = next;
		}
		onRowClick?.(row);
	}
</script>

<div class="table-wrap">
	{#if searchable || toolbar}
		<div class="toolbar">
			{#if searchable}
				<input class="input search" type="search" placeholder={searchPlaceholder} bind:value={query} aria-label={searchPlaceholder} />
			{/if}
			{#if toolbar}{@render toolbar()}{/if}
			<span class="muted small count">{sorted.length.toLocaleString()} row{sorted.length === 1 ? '' : 's'}</span>
		</div>
	{/if}

	<div class="scroll" style:max-height={maxHeight ? `${maxHeight}px` : null}>
		<table class="data">
			<thead>
				<tr>
					{#each columns as col (col.key)}
						<th
							class:num={col.align === 'right'}
							class:sortable={col.sortable !== false}
							style:width={col.width ?? null}
							title={col.hint ?? null}
							aria-sort={sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
							onclick={() => toggleSort(col)}
						>
							{col.label}{#if sortKey === col.key}<span class="arrow">{sortDir === 'asc' ? '▲' : '▼'}</span>{/if}
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each visible as row (rowKey(row))}
					{@const key = rowKey(row)}
					<tr
						class:selected={selectedKey === key}
						class:clickable={!!onRowClick || !!expand}
						class:expanded={expanded.has(key)}
						onclick={() => clickRow(row)}
					>
						{#each columns as col (col.key)}
							<td class:num={col.align === 'right'} class:mono={col.mono} title={col.title ? col.title(row) : null}>
								{#if cell}{@render cell(row, col)}{:else}{cellText(row, col)}{/if}
							</td>
						{/each}
					</tr>
					{#if expand && expanded.has(key)}
						<tr class="detail">
							<td colspan={columns.length}>{@render expand(row)}</td>
						</tr>
					{/if}
				{/each}
				{#if !visible.length}
					<tr><td colspan={columns.length} class="empty">{empty}</td></tr>
				{/if}
			</tbody>
		</table>
	</div>

	{#if size > 0 && sorted.length > size}
		<div class="pager">
			<span class="muted small">
				Showing {(current * size + 1).toLocaleString()}–{Math.min(sorted.length, (current + 1) * size).toLocaleString()} of {sorted.length.toLocaleString()}
			</span>
			<div class="row">
				<label class="small muted">
					Per page
					<select class="input" bind:value={size}>
						<option value={25}>25</option>
						<option value={50}>50</option>
						<option value={100}>100</option>
						<option value={250}>250</option>
						<option value={0}>All</option>
					</select>
				</label>
				<button class="btn" disabled={current === 0} onclick={() => (page = current - 1)}>Prev</button>
				<button class="btn" disabled={current >= pageCount - 1} onclick={() => (page = current + 1)}>Next</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.table-wrap {
		min-width: 0;
	}
	.scroll {
		overflow: auto;
		border: 1px solid var(--grid);
		border-radius: var(--radius-sm);
	}
	.search {
		min-width: 220px;
		flex: 1 1 220px;
		max-width: 420px;
	}
	.count {
		margin-left: auto;
	}
	.arrow {
		font-size: 9px;
		margin-left: 4px;
		color: var(--muted);
	}
	tr.clickable {
		cursor: pointer;
	}
	tr.detail td {
		background: var(--surface-2);
		padding: 10px 14px 14px;
	}
	tr.detail:hover td {
		background: var(--surface-2);
	}
	td.mono {
		font-family: var(--mono);
		font-size: 12px;
		word-break: break-all;
	}
	.pager {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		margin-top: 10px;
		flex-wrap: wrap;
	}
	.pager select {
		padding: 4px 6px;
	}
	.pager .btn {
		padding: 5px 10px;
	}
</style>
