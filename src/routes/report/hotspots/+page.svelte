<script lang="ts">
	import type { PageProps } from './$types';
	import type { FileInfo, FunctionInfo } from '#lib/types.js';
	import { cellText, type Column } from '#lib/table.js';
	import Chart from '#lib/components/Chart.svelte';
	import DataTable from '#lib/components/DataTable.svelte';
	import StatTile from '#lib/components/StatTile.svelte';
	import { theme } from '#lib/theme.svelte.js';
	import { OTHER_COLOR, series, withAlpha } from '#lib/colors.js';
	import { ago, fmt, pct, reportHref, shortPath } from '#lib/format.js';

	let { data }: PageProps = $props();
	const a = $derived(data.analysis);
	const s = $derived(a.summary);
	const dark = $derived(theme.isDark);
	const hasGit = $derived(a.git !== null && a.files.some((f) => f.git));

	interface Hotspot {
		file: FileInfo;
		churn: number;
		recent: number;
		complexity: number;
		score: number;
	}

	const parsed = $derived(a.files.filter((f) => !f.skipped && !f.isDeclaration));

	const hotspots = $derived.by((): Hotspot[] => {
		const churnOf = (f: FileInfo) => (hasGit ? (f.git?.commits ?? 0) + (f.git?.recentCommits ?? 0) : f.loc);
		const maxChurn = Math.max(1, ...parsed.map((f) => Math.log1p(churnOf(f))));
		const maxComplexity = Math.max(1, ...parsed.map((f) => f.complexity));
		return parsed
			.map((f) => {
				const churn = churnOf(f);
				const c = Math.log1p(churn) / maxChurn;
				const x = f.complexity / maxComplexity;
				return { file: f, churn, recent: f.git?.recentCommits ?? 0, complexity: f.complexity, score: Math.round(100 * Math.sqrt(c * x)) };
			})
			.sort((p, q) => q.score - p.score);
	});

	const TOP = 10;
	const topIds = $derived(new Set(hotspots.slice(0, TOP).map((h) => h.file.path)));

	const scatterData = $derived.by(() => {
		const point = (h: Hotspot) => ({
			x: hasGit ? Math.max(1, h.file.git?.commits ?? 0) : h.file.loc,
			y: h.complexity,
			r: Math.max(3, Math.min(18, Math.sqrt(h.file.loc) / 2.2)),
			label: h.file.path
		});
		const rest = hotspots.filter((h) => !topIds.has(h.file.path));
		const top = hotspots.filter((h) => topIds.has(h.file.path));
		return {
			datasets: [
				{ label: `Top ${TOP} hotspots`, data: top.map(point), backgroundColor: withAlpha(series(1, dark), 0.85), borderColor: dark ? '#1a1a19' : '#fcfcfb' },
				{ label: 'Other files', data: rest.map(point), backgroundColor: withAlpha(OTHER_COLOR, 0.45), borderColor: 'transparent' }
			]
		};
	});
	const maxChurn = $derived(Math.max(1, ...hotspots.map((h) => (hasGit ? h.file.git?.commits ?? 0 : h.file.loc))));
	const scatterOptions = $derived({
		scales: {
			x: {
				type: maxChurn > 60 ? ('logarithmic' as const) : ('linear' as const),
				title: { display: true, text: hasGit ? 'commits touching the file (log scale)' : 'lines of code', color: '#898781', font: { size: 11 } },
				beginAtZero: false
			},
			y: { title: { display: true, text: 'cyclomatic complexity', color: '#898781', font: { size: 11 } } }
		},
		plugins: {
			legend: { display: true },
			tooltip: {
				callbacks: {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					title: (items: any[]) => items.map((i) => i.raw.label),
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					label: (item: any) => `${hasGit ? 'commits' : 'lines'}: ${item.raw.x} · complexity: ${item.raw.y}`
				}
			}
		}
	});

	const hotspotColumns = $derived<Column<Hotspot>[]>([
		{ key: 'path', label: 'File', mono: true, value: (h) => h.file.path },
		{ key: 'score', label: 'Hotspot score', align: 'right', hint: 'Geometric mean of normalised churn and complexity (0–100)' },
		...(hasGit
			? [
					{ key: 'commits', label: 'Commits', align: 'right', value: (h: Hotspot) => h.file.git?.commits ?? 0 } as Column<Hotspot>,
					{ key: 'recent', label: 'Last 12 months', align: 'right' } as Column<Hotspot>,
					{ key: 'authors', label: 'Authors', align: 'right', value: (h: Hotspot) => h.file.git?.authors ?? 0 } as Column<Hotspot>
				]
			: []),
		{ key: 'complexity', label: 'Complexity', align: 'right' },
		{ key: 'maxComplexity', label: 'Max fn', align: 'right', value: (h) => h.file.maxComplexity },
		{ key: 'loc', label: 'Lines', align: 'right', value: (h) => h.file.loc },
		{ key: 'functions', label: 'Functions', align: 'right', value: (h) => h.file.functionCount },
		...(hasGit ? [{ key: 'last', label: 'Last change', value: (h: Hotspot) => h.file.git?.lastModified ?? '', format: (h: Hotspot) => (h.file.git ? ago(h.file.git.lastModified) : '–') } as Column<Hotspot>] : [])
	]);

	interface FnRow {
		fn: FunctionInfo;
		file: FileInfo;
	}
	const allFunctions = $derived.by((): FnRow[] => {
		const rows: FnRow[] = [];
		for (const file of parsed) for (const fn of file.functions) rows.push({ fn, file });
		return rows;
	});
	const longest = $derived([...allFunctions].sort((p, q) => q.fn.lines - p.fn.lines).slice(0, 12));
	const mostComplex = $derived([...allFunctions].sort((p, q) => q.fn.complexity - p.fn.complexity).slice(0, 12));
	const mostParams = $derived([...allFunctions].filter((r) => r.fn.params > 4).sort((p, q) => q.fn.params - p.fn.params).slice(0, 8));
	const deepest = $derived([...parsed].filter((f) => f.maxDepth >= 6).sort((p, q) => q.maxDepth - p.maxDepth).slice(0, 8));
	const anyFiles = $derived([...parsed].filter((f) => f.anyCount > 0).sort((p, q) => q.anyCount - p.anyCount).slice(0, 10));
	const directiveFiles = $derived([...parsed].filter((f) => f.tsDirectives > 0).sort((p, q) => q.tsDirectives - p.tsDirectives).slice(0, 10));
	const consoleFiles = $derived([...parsed].filter((f) => f.consoleCalls > 0 && !f.isTest).sort((p, q) => q.consoleCalls - p.consoleCalls).slice(0, 10));
	const todoFiles = $derived([...parsed].filter((f) => f.todos > 0).sort((p, q) => q.todos - p.todos).slice(0, 10));
	const errorFiles = $derived(a.files.filter((f) => f.syntaxErrors > 0).slice(0, 20));
	const fnTotal = $derived(Math.max(1, s.functions));

	const fnColumns: Column<FnRow>[] = [
		{ key: 'name', label: 'Function', mono: true, value: (r) => r.fn.name },
		{ key: 'file', label: 'File', mono: true, value: (r) => `${r.file.path}:${r.fn.line}` },
		{ key: 'lines', label: 'Lines', align: 'right', value: (r) => r.fn.lines },
		{ key: 'complexity', label: 'Complexity', align: 'right', value: (r) => r.fn.complexity },
		{ key: 'params', label: 'Params', align: 'right', value: (r) => r.fn.params }
	];
</script>

<div class="stack">
	<section class="tiles">
		<StatTile label="Long functions" value={fmt(s.longFunctions)} hint="over 50 lines · {pct(s.longFunctions / fnTotal)} of functions" tone={s.longFunctions / fnTotal > 0.1 ? 'warn' : 'neutral'} />
		<StatTile label="Complex functions" value={fmt(s.complexFunctions)} hint="cyclomatic complexity above 10" tone={s.complexFunctions / fnTotal > 0.05 ? 'warn' : 'neutral'} />
		<StatTile label="Many parameters" value={fmt(s.manyParamFunctions)} hint="more than 4 parameters" />
		<StatTile label="Deep nesting" value={fmt(deepest.length === 8 ? parsed.filter((f) => f.maxDepth >= 6).length : deepest.length)} hint="files nested 6+ blocks deep" />
		{#if s.tsFiles}
			<StatTile label="any usages" value={fmt(s.anyCount)} hint="explicit any types in TypeScript" tone={s.anyCount > 0 ? 'warn' : 'good'} />
			<StatTile label="ts-ignore / expect-error" value={fmt(s.tsDirectives)} hint="suppressed type errors" tone={s.tsDirectives > 0 ? 'warn' : 'good'} />
		{/if}
		<StatTile label="console calls" value={fmt(s.consoleCalls)} hint="console.* statements" />
		<StatTile label="TODO / FIXME" value={fmt(s.todos)} hint="markers in comments" />
		<StatTile label="Syntax errors" value={fmt(s.filesWithSyntaxErrors)} hint="files tree-sitter could not fully parse" tone={s.filesWithSyntaxErrors ? 'bad' : 'good'} />
	</section>

	<section class="card">
		<div class="card-head">
			<h2>Hotspots</h2>
			<p>
				{#if hasGit}
					files that change often <em>and</em> are complex are where bugs and merge conflicts concentrate · bubble size = lines of code
				{:else}
					without git history, hotspots rank files by size and complexity · bubble size = lines of code
				{/if}
			</p>
		</div>
		<Chart type="bubble" data={scatterData} options={scatterOptions} height={360} title="Churn versus complexity per file" formatValue={(v) => fmt(v)} />
	</section>

	<section class="card">
		<div class="card-head"><h2>Hotspot ranking</h2><p>{hasGit ? 'churn = commits plus commits in the last 12 months' : 'ranked by lines and complexity'}</p></div>
		<DataTable rows={hotspots.slice(0, 200)} columns={hotspotColumns} rowKey={(h) => h.file.path} sortKey="score" sortDir="desc" pageSize={20} searchable searchPlaceholder="Filter files…">
			{#snippet cell(h: Hotspot, col: Column<Hotspot>)}
				{#if col.key === 'path'}
					<a class="path" href={reportHref('files', a.path, { q: h.file.path })} title={h.file.path}>{h.file.path}</a>
				{:else if col.key === 'score'}
					<span class="score"><span class="bar" style:width="{h.score}%"></span><span>{h.score}</span></span>
				{:else}
					{cellText(h, col)}
				{/if}
			{/snippet}
		</DataTable>
	</section>

	<section class="grid grid-2">
		<div class="card">
			<div class="card-head"><h2>Longest functions</h2><p>candidates for splitting</p></div>
			<DataTable rows={longest} columns={fnColumns} rowKey={(r) => r.file.path + r.fn.line + r.fn.name} sortKey="lines" sortDir="desc" pageSize={0}>
				{#snippet cell(r: FnRow, col: Column<FnRow>)}
					{#if col.key === 'file'}<a class="path" href={reportHref('files', a.path, { q: r.file.path })} title={r.file.path}>{shortPath(r.file.path, 36)}:{r.fn.line}</a>{:else}{cellText(r, col)}{/if}
				{/snippet}
			</DataTable>
		</div>
		<div class="card">
			<div class="card-head"><h2>Most complex functions</h2><p>cyclomatic complexity</p></div>
			<DataTable rows={mostComplex} columns={fnColumns} rowKey={(r) => r.file.path + r.fn.line + r.fn.name} sortKey="complexity" sortDir="desc" pageSize={0}>
				{#snippet cell(r: FnRow, col: Column<FnRow>)}
					{#if col.key === 'file'}<a class="path" href={reportHref('files', a.path, { q: r.file.path })} title={r.file.path}>{shortPath(r.file.path, 36)}:{r.fn.line}</a>{:else}{cellText(r, col)}{/if}
				{/snippet}
			</DataTable>
		</div>
	</section>

	<section class="grid grid-3">
		<div class="card">
			<div class="card-head"><h2>Type safety</h2></div>
			{#if !s.tsFiles}
				<p class="muted small">No TypeScript files.</p>
			{:else}
				<h3 class="sub">Files using <code>any</code></h3>
				{#if anyFiles.length}
					<ul class="list compact">{#each anyFiles as f (f.path)}<li><a class="path" href={reportHref('files', a.path, { q: f.path })} title={f.path}>{shortPath(f.path, 40)}</a><span class="num muted">{f.anyCount}</span></li>{/each}</ul>
				{:else}<p class="muted small">None.</p>{/if}
				<h3 class="sub">Suppressed type errors</h3>
				{#if directiveFiles.length}
					<ul class="list compact">{#each directiveFiles as f (f.path)}<li><a class="path" href={reportHref('files', a.path, { q: f.path })} title={f.path}>{shortPath(f.path, 40)}</a><span class="num muted">{f.tsDirectives}</span></li>{/each}</ul>
				{:else}<p class="muted small">None.</p>{/if}
			{/if}
			<h3 class="sub">Syntax errors</h3>
			{#if errorFiles.length}
				<ul class="list compact">{#each errorFiles as f (f.path)}<li><a class="path" href={reportHref('files', a.path, { q: f.path })} title={f.path}>{shortPath(f.path, 40)}</a><span class="num muted">{f.syntaxErrors}</span></li>{/each}</ul>
			{:else}<p class="muted small">All parsed files are syntactically valid.</p>{/if}
		</div>
		<div class="card">
			<div class="card-head"><h2>Leftovers</h2></div>
			<h3 class="sub">console.* in non-test files</h3>
			{#if consoleFiles.length}
				<ul class="list compact">{#each consoleFiles as f (f.path)}<li><a class="path" href={reportHref('files', a.path, { q: f.path })} title={f.path}>{shortPath(f.path, 40)}</a><span class="num muted">{f.consoleCalls}</span></li>{/each}</ul>
			{:else}<p class="muted small">None.</p>{/if}
			<h3 class="sub">TODO / FIXME / HACK</h3>
			{#if todoFiles.length}
				<ul class="list compact">{#each todoFiles as f (f.path)}<li><a class="path" href={reportHref('files', a.path, { q: f.path })} title={f.path}>{shortPath(f.path, 40)}</a><span class="num muted">{f.todos}</span></li>{/each}</ul>
			{:else}<p class="muted small">None.</p>{/if}
		</div>
		<div class="card">
			<div class="card-head"><h2>Structure smells</h2></div>
			<h3 class="sub">Deepest nesting</h3>
			{#if deepest.length}
				<ul class="list compact">{#each deepest as f (f.path)}<li><a class="path" href={reportHref('files', a.path, { q: f.path })} title={f.path}>{shortPath(f.path, 40)}</a><span class="num muted">{f.maxDepth} levels</span></li>{/each}</ul>
			{:else}<p class="muted small">No file nests deeper than 5 blocks.</p>{/if}
			<h3 class="sub">Most parameters</h3>
			{#if mostParams.length}
				<ul class="list compact">{#each mostParams as r (r.file.path + r.fn.line)}<li><span class="path"><span class="mono">{r.fn.name}</span> <a href={reportHref('files', a.path, { q: r.file.path })} class="muted">{shortPath(r.file.path, 28)}:{r.fn.line}</a></span><span class="num muted">{r.fn.params}</span></li>{/each}</ul>
			{:else}<p class="muted small">No function takes more than 4 parameters.</p>{/if}
		</div>
	</section>
</div>

<style>
	.sub {
		margin: 12px 0 6px;
	}
	.sub:first-of-type {
		margin-top: 0;
	}
	.list.compact li {
		padding: 3px 0;
	}
	.score {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		justify-content: flex-end;
		width: 100%;
	}
	.score .bar {
		display: inline-block;
		height: 6px;
		max-width: 70px;
		min-width: 2px;
		flex: 0 0 auto;
		border-radius: 3px;
		background: var(--series-2);
		opacity: 0.8;
	}
</style>
