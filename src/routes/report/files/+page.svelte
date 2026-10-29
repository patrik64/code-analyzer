<script lang="ts">
	import { page } from '$app/state';
	import type { PageProps } from './$types';
	import type { FileInfo, Language } from '#lib/types.js';
	import { cellText, type Column } from '#lib/table.js';
	import Chart from '#lib/components/Chart.svelte';
	import DataTable from '#lib/components/DataTable.svelte';
	import { theme } from '#lib/theme.svelte.js';
	import { LANGUAGE_LABEL, LANGUAGE_ORDER, languageColor, series } from '#lib/colors.js';
	import { ago, fmt, fmtDate, reportHref, shortPath } from '#lib/format.js';

	let { data }: PageProps = $props();
	const a = $derived(data.analysis);
	const dark = $derived(theme.isDark);

	let query = $state(page.url.searchParams.get('q') ?? '');
	let language = $state<'all' | Language>('all');
	let dir = $state('all');
	let hideTests = $state(false);
	let hideDeclarations = $state(false);
	let sortKey = $state('loc');
	let sortDir = $state<'asc' | 'desc'>('desc');

	const hasGit = $derived(a.git !== null);
	const languages = $derived(LANGUAGE_ORDER.filter((l) => a.summary.byLanguage[l].files > 0));
	const dirs = $derived.by(() => {
		const list = a.directories.filter((d) => d.path && !d.path.includes('/')).map((d) => d.path).sort();
		if (a.files.some((f) => f.dir === '')) list.unshift('(root)');
		return list;
	});

	const filtered = $derived(
		a.files.filter(
			(f) =>
				(language === 'all' || f.language === language) &&
				(dir === 'all' || (dir === '(root)' ? f.dir === '' : f.path.startsWith(dir + '/'))) &&
				(!hideTests || !f.isTest) &&
				(!hideDeclarations || !f.isDeclaration)
		)
	);

	const importersOf = $derived.by(() => {
		const map = new Map<string, string[]>();
		for (const e of a.graph.edges) {
			let list = map.get(e.target);
			if (!list) map.set(e.target, (list = []));
			list.push(e.source);
		}
		for (const list of map.values()) list.sort();
		return map;
	});

	const columns = $derived.by(() => {
		const cols: Column<FileInfo>[] = [
			{ key: 'path', label: 'File', mono: true, value: (f) => f.path },
			{ key: 'language', label: 'Lang', value: (f) => LANGUAGE_LABEL[f.language], width: '70px' },
			{ key: 'loc', label: 'Lines', align: 'right', hint: 'Total lines in the file' },
			{ key: 'sloc', label: 'Code', align: 'right', hint: 'Lines that are neither blank nor comment-only' },
			{ key: 'commentLines', label: 'Comments', align: 'right', hint: 'Comment-only lines' },
			{ key: 'functionCount', label: 'Functions', align: 'right' },
			{ key: 'classCount', label: 'Classes', align: 'right' },
			{ key: 'importCount', label: 'Imports', align: 'right', hint: 'Import statements, require() calls, dynamic imports and re-exports' },
			{ key: 'importedBy', label: 'Imported by', align: 'right', hint: 'Project files that import this file' },
			{ key: 'exportCount', label: 'Exports', align: 'right' },
			{ key: 'complexity', label: 'Complexity', align: 'right', hint: 'Sum of the cyclomatic complexity of all functions plus module-level branches' },
			{ key: 'maxComplexity', label: 'Max fn', align: 'right', hint: 'Cyclomatic complexity of the most complex function' },
			{ key: 'maxDepth', label: 'Depth', align: 'right', hint: 'Deepest block nesting' }
		];
		if (hasGit) {
			cols.push(
				{ key: 'commits', label: 'Commits', align: 'right', value: (f) => f.git?.commits ?? null, hint: 'Commits touching this file' },
				{ key: 'authors', label: 'Authors', align: 'right', value: (f) => f.git?.authors ?? null },
				{ key: 'lastModified', label: 'Last change', value: (f) => f.git?.lastModified ?? null, format: (f) => (f.git ? ago(f.git.lastModified) : '–'), title: (f) => (f.git ? fmtDate(f.git.lastModified) : '') }
			);
		}
		return cols;
	});

	const topByLoc = $derived([...filtered].sort((x, y) => y.loc - x.loc).slice(0, 15));
	const topByFunctions = $derived([...filtered].sort((x, y) => y.functionCount - x.functionCount).slice(0, 15));
	const locData = $derived({
		labels: topByLoc.map((f) => shortPath(f.path, 40)),
		datasets: [{ label: 'Lines', data: topByLoc.map((f) => f.loc), backgroundColor: series(0, dark) }]
	});
	const fnData = $derived({
		labels: topByFunctions.map((f) => shortPath(f.path, 40)),
		datasets: [{ label: 'Functions', data: topByFunctions.map((f) => f.functionCount), backgroundColor: series(0, dark) }]
	});
	const horizontal = {
		indexAxis: 'y' as const,
		scales: { x: { beginAtZero: true }, y: { grid: { display: false }, ticks: { autoSkip: false, font: { size: 11 } } } }
	};

	function pathFilter(f: FileInfo, q: string) {
		return f.path.toLowerCase().includes(q) || f.classes.some((c) => c.toLowerCase().includes(q)) || f.functions.some((fn) => fn.name.toLowerCase().includes(q));
	}

	const kindLabel: Record<string, string> = {
		function: 'function',
		arrow: 'arrow',
		method: 'method',
		constructor: 'constructor',
		getter: 'getter',
		setter: 'setter',
		generator: 'generator',
		expression: 'function expr.'
	};
</script>

<div class="stack">
	<section class="grid grid-2">
		<div class="card">
			<div class="card-head"><h2>Largest files</h2><p>by lines, within the current filter</p></div>
			<Chart type="bar" data={locData} height={Math.max(160, topByLoc.length * 24 + 40)} title="Largest files by lines of code" options={horizontal} />
		</div>
		<div class="card">
			<div class="card-head"><h2>Most functions</h2><p>function declarations, arrows and methods</p></div>
			<Chart type="bar" data={fnData} height={Math.max(160, topByFunctions.length * 24 + 40)} title="Files with the most functions" options={horizontal} />
		</div>
	</section>

	<section class="card">
		<div class="card-head">
			<h2>All files</h2>
			<p>{fmt(filtered.length)} of {fmt(a.files.length)} files · click a row for functions and imports</p>
		</div>
		<DataTable
			rows={filtered}
			{columns}
			rowKey={(f) => f.path}
			bind:sortKey
			bind:sortDir
			bind:query
			searchable
			searchPlaceholder="Filter by path, function or class name…"
			filter={pathFilter}
			pageSize={50}
			empty="No files match the current filter."
		>
			{#snippet toolbar()}
				<label>
					Language
					<select class="input" bind:value={language}>
						<option value="all">all</option>
						{#each languages as l (l)}
							<option value={l}>{LANGUAGE_LABEL[l]}</option>
						{/each}
					</select>
				</label>
				<label>
					Folder
					<select class="input" bind:value={dir}>
						<option value="all">all</option>
						{#each dirs as d (d)}
							<option value={d}>{d}</option>
						{/each}
					</select>
				</label>
				<label><input type="checkbox" bind:checked={hideTests} /> hide tests</label>
				{#if a.summary.declarationFiles}
					<label><input type="checkbox" bind:checked={hideDeclarations} /> hide .d.ts</label>
				{/if}
			{/snippet}

			{#snippet cell(f: FileInfo, col: Column<FileInfo>)}
				{#if col.key === 'path'}
					<span class="file-cell">
						<a href={reportHref('graph', a.path, { node: f.path })} title="Show {f.path} in the import graph" onclick={(e) => e.stopPropagation()}>{f.path}</a>
						{#if f.isTest}<span class="flag">test</span>{/if}
						{#if f.isDeclaration}<span class="flag">d.ts</span>{/if}
						{#if f.skipped}<span class="flag warn" title="Counted but not parsed">{f.skipped}</span>{/if}
						{#if f.syntaxErrors}<span class="flag bad" title="{f.syntaxErrors} syntax error nodes">errors</span>{/if}
					</span>
				{:else if col.key === 'language'}
					<span class="lang"><span class="dot" style:background={languageColor(f.language, dark)}></span>{f.language}</span>
				{:else}
					{cellText(f, col)}
				{/if}
			{/snippet}

			{#snippet expand(f: FileInfo)}
				{@const importers = importersOf.get(f.path) ?? []}
				<div class="detail">
					<div class="detail-col">
						<h3>Functions ({f.functions.length})</h3>
						{#if f.functions.length}
							<div class="detail-scroll">
								<table class="data small">
									<thead>
										<tr><th>Name</th><th>Kind</th><th class="num">Line</th><th class="num">Lines</th><th class="num">Params</th><th class="num">Complexity</th><th>Flags</th></tr>
									</thead>
									<tbody>
										{#each [...f.functions].sort((x, y) => y.complexity - x.complexity || y.lines - x.lines).slice(0, 300) as fn (fn.line + fn.name)}
											<tr>
												<td class="mono">{fn.name}</td>
												<td class="muted">{kindLabel[fn.kind] ?? fn.kind}</td>
												<td class="num">{fn.line}</td>
												<td class="num">{fn.lines}</td>
												<td class="num">{fn.params}</td>
												<td class="num" class:hot={fn.complexity > 10}>{fn.complexity}</td>
												<td class="muted">{[fn.async ? 'async' : '', fn.exported ? 'exported' : ''].filter(Boolean).join(', ')}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{:else}
							<p class="muted small">No functions.</p>
						{/if}
						{#if f.classes.length}
							<h3>Classes</h3>
							<div class="row small">{#each f.classes as c (c)}<span class="badge mono">{c}</span>{/each}</div>
						{/if}
					</div>
					<div class="detail-col">
						<h3>Imports ({f.imports.length})</h3>
						{#if f.imports.length}
							<ul class="list compact">
								{#each f.imports as imp, i (i)}
									<li>
										<span class="path">
											{#if imp.target === 'internal' && imp.resolved}
												<a href={reportHref('files', a.path, { q: imp.resolved })}>{imp.resolved}</a>
											{:else}
												{imp.source}
											{/if}
										</span>
										<span class="muted small">{imp.kind === 'static' ? '' : imp.kind}{imp.typeOnly ? ' type-only' : ''} {imp.target === 'internal' ? '' : imp.target}</span>
									</li>
								{/each}
							</ul>
						{:else}
							<p class="muted small">No imports.</p>
						{/if}
						<h3>Imported by ({importers.length})</h3>
						{#if importers.length}
							<ul class="list compact">
								{#each importers as p (p)}
									<li><a class="path" href={reportHref('files', a.path, { q: p })}>{p}</a></li>
								{/each}
							</ul>
						{:else}
							<p class="muted small">Not imported by any project file.</p>
						{/if}
						<h3>Signals</h3>
						<div class="row small">
							<span class="badge">{f.exportCount} exports{f.hasDefaultExport ? ' (default)' : ''}</span>
							{#if f.typeDefs}<span class="badge">{f.typeDefs} type defs</span>{/if}
							{#if f.jsxElements}<span class="badge">{f.jsxElements} JSX elements</span>{/if}
							{#if f.anyCount}<span class="badge badge-warn">{f.anyCount} × any</span>{/if}
							{#if f.tsDirectives}<span class="badge badge-warn">{f.tsDirectives} ts-ignore/expect-error</span>{/if}
							{#if f.consoleCalls}<span class="badge">{f.consoleCalls} console calls</span>{/if}
							{#if f.todos}<span class="badge">{f.todos} TODO/FIXME</span>{/if}
							{#if f.syntaxErrors}<span class="badge badge-bad">{f.syntaxErrors} syntax errors</span>{/if}
							{#if f.git}<span class="badge">{f.git.commits} commits · {f.git.authors} authors · top {f.git.topAuthor}</span>{/if}
						</div>
						<p class="small" style:margin-top="10px"><a href={reportHref('graph', a.path, { node: f.path })}>Show in import graph →</a></p>
					</div>
				</div>
			{/snippet}
		</DataTable>
	</section>
</div>

<style>
	.file-cell {
		display: inline-flex;
		gap: 6px;
		align-items: center;
		flex-wrap: wrap;
	}
	.file-cell a {
		color: var(--text);
	}
	.file-cell a:hover {
		color: var(--accent);
	}
	.flag {
		font-size: 10px;
		padding: 0 5px;
		border-radius: 999px;
		background: var(--surface-3);
		color: var(--text-2);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.flag.warn {
		background: color-mix(in oklab, var(--warning) 25%, transparent);
	}
	.flag.bad {
		background: color-mix(in oklab, var(--critical) 25%, transparent);
	}
	.lang {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		display: inline-block;
	}
	.detail {
		display: grid;
		grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
		gap: 20px;
	}
	.detail h3 {
		margin: 10px 0 6px;
	}
	.detail h3:first-child {
		margin-top: 0;
	}
	.detail-scroll {
		max-height: 320px;
		overflow: auto;
		border: 1px solid var(--grid);
		border-radius: var(--radius-sm);
		background: var(--surface);
	}
	.detail-scroll th,
	.detail-scroll td {
		padding: 4px 8px;
	}
	.hot {
		color: var(--critical);
		font-weight: 600;
	}
	.list.compact li {
		padding: 3px 0;
	}
	@media (max-width: 900px) {
		.detail {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
