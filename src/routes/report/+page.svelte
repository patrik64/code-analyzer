<script lang="ts">
	import type { PageProps } from './$types';
	import Chart from '#lib/components/Chart.svelte';
	import StatTile from '#lib/components/StatTile.svelte';
	import Treemap from '#lib/components/Treemap.svelte';
	import { theme } from '#lib/theme.svelte.js';
	import { LANGUAGE_LABEL, LANGUAGE_ORDER, languageColor, series, withAlpha } from '#lib/colors.js';
	import { ago, bytes, compact, fixed, fmt, pct, plural, reportHref, shortPath } from '#lib/format.js';
	import { buildGrouping } from '#lib/groups.js';
	import { goto } from '$app/navigation';

	let { data }: PageProps = $props();
	const a = $derived(data.analysis);
	const s = $derived(a.summary);
	const dark = $derived(theme.isDark);
	const grouping = $derived(buildGrouping(a.files.map((f) => f.path)));

	const languages = $derived(LANGUAGE_ORDER.filter((l) => s.byLanguage[l].files > 0));
	const languageData = $derived({
		labels: languages.map((l) => LANGUAGE_LABEL[l]),
		datasets: [
			{
				label: 'Lines of code',
				data: languages.map((l) => s.byLanguage[l].loc),
				backgroundColor: languages.map((l) => languageColor(l, dark))
			}
		]
	});

	const topDirs = $derived.by(() => {
		const depth1 = a.directories.filter((d) => d.path !== '' && !d.path.includes('/'));
		const root = a.directories.find((d) => d.path === '');
		const list = [...depth1];
		if (root) list.push({ ...root, path: '(root files)' });
		return list.sort((x, y) => y.loc - x.loc).slice(0, 12);
	});
	const dirData = $derived({
		labels: topDirs.map((d) => d.path),
		datasets: [{ label: 'Lines of code', data: topDirs.map((d) => d.loc), backgroundColor: series(0, dark) }]
	});

	const sizeBins = [
		{ label: '≤ 50', max: 50 },
		{ label: '51–100', max: 100 },
		{ label: '101–200', max: 200 },
		{ label: '201–400', max: 400 },
		{ label: '401–800', max: 800 },
		{ label: '801–1600', max: 1600 },
		{ label: '> 1600', max: Infinity }
	];
	const sizeData = $derived.by(() => {
		const counts = sizeBins.map(() => 0);
		for (const f of a.files) {
			const i = sizeBins.findIndex((b) => f.loc <= b.max);
			counts[i === -1 ? counts.length - 1 : i]++;
		}
		return {
			labels: sizeBins.map((b) => b.label),
			datasets: [{ label: 'Files', data: counts, backgroundColor: series(0, dark) }]
		};
	});

	const complexityBins = [
		{ label: '1', max: 1 },
		{ label: '2–3', max: 3 },
		{ label: '4–6', max: 6 },
		{ label: '7–10', max: 10 },
		{ label: '11–20', max: 20 },
		{ label: '> 20', max: Infinity }
	];
	const complexityData = $derived.by(() => {
		const counts = complexityBins.map(() => 0);
		for (const f of a.files) {
			for (const fn of f.functions) {
				const i = complexityBins.findIndex((b) => fn.complexity <= b.max);
				counts[i === -1 ? counts.length - 1 : i]++;
			}
		}
		return {
			labels: complexityBins.map((b) => b.label),
			datasets: [{ label: 'Functions', data: counts, backgroundColor: series(0, dark) }]
		};
	});

	const largest = $derived([...a.files].sort((x, y) => y.loc - x.loc).slice(0, 8));
	const hubs = $derived(a.graph.hubs.slice(0, 8));
	const entries = $derived(a.graph.entryPoints.slice(0, 8));

	const scriptEntries = $derived(Object.entries(a.project.scripts));
	let showAllScripts = $state(false);

	const frameworksByCategory = $derived.by(() => {
		const order: Record<string, number> = {
			'meta-framework': 0,
			framework: 1,
			ui: 2,
			runtime: 3,
			data: 4,
			build: 5,
			test: 6,
			style: 7,
			lint: 8
		};
		return [...a.project.frameworks].sort((x, y) => (order[x.category] ?? 9) - (order[y.category] ?? 9));
	});

	const horizontalBar = {
		indexAxis: 'y' as const,
		scales: { x: { beginAtZero: true, grid: { display: true } }, y: { grid: { display: false } } }
	};
</script>

<div class="stack">
	<section class="tiles">
		<StatTile
			label="Files"
			value={fmt(s.files)}
			hint="{s.tsFiles} TS · {s.jsFiles} JS{s.componentFiles ? ` · ${s.componentFiles} components` : ''}"
		/>
		<StatTile label="Lines" value={compact(s.loc)} hint="{compact(s.sloc)} code · {compact(s.commentLines)} comments · {bytes(s.bytes)}" />
		<StatTile label="Functions" value={fmt(s.functions)} hint="avg {fixed(s.avgFunctionLength, 0)} lines · {fmt(s.asyncFunctions)} async" />
		<StatTile label="Classes" value={fmt(s.classes)} hint={s.typeDefs ? `${fmt(s.typeDefs)} interfaces/types/enums` : undefined} />
		<StatTile label="Imports" value={fmt(s.imports)} hint="{fmt(s.internalImports)} internal · {fmt(s.externalImports)} external" />
		<StatTile label="Exports" value={fmt(s.exports)} hint="{a.externals.filter((e) => !e.builtin && !e.virtual).length} external packages used" />
		<StatTile
			label="Complexity / function"
			value={fixed(s.avgComplexityPerFunction, 1)}
			hint="{fmt(s.complexFunctions)} functions above 10"
			tone={s.complexFunctions > s.functions * 0.05 ? 'warn' : 'neutral'}
		/>
		<StatTile label="Comment ratio" value={pct(s.commentRatio)} hint="comment lines ÷ (code + comments)" />
		<StatTile label="Test files" value={fmt(s.testFiles)} hint={s.testFiles ? `${pct(s.testLoc / Math.max(1, s.loc))} of lines` : 'none detected'} tone={s.testFiles ? 'neutral' : 'warn'} />
		<StatTile label="Circular imports" value={fmt(s.cycles)} hint={s.cycles ? 'see import graph' : 'none found'} tone={s.cycles ? 'bad' : 'good'} />
		<StatTile label="Unresolved imports" value={fmt(s.unresolvedImports)} hint={s.unresolvedImports ? 'relative imports with no target file' : 'all relative imports resolve'} tone={s.unresolvedImports ? 'warn' : 'good'} />
		<StatTile label="Median file size" value="{fmt(s.medianFileLoc)} lines" hint="average {fixed(s.avgFileLoc, 0)} lines" />
	</section>

	<section class="grid grid-3">
		<div class="card">
			<div class="card-head"><h2>Lines by language</h2><p>{plural(languages.length, 'language')}</p></div>
			<Chart type="doughnut" data={languageData} height={240} title="Lines of code by language" options={{ cutout: '62%', plugins: { legend: { display: true } } }} />
		</div>
		<div class="card">
			<div class="card-head"><h2>Lines by top-level folder</h2><p>largest {topDirs.length}</p></div>
			<Chart type="bar" data={dirData} height={240} title="Lines of code by top-level directory" options={horizontalBar} />
		</div>
		<div class="card">
			<div class="card-head"><h2>File size distribution</h2><p>files per lines-of-code band</p></div>
			<Chart type="bar" data={sizeData} height={240} title="File size distribution" />
		</div>
	</section>

	<section class="card">
		<div class="card-head">
			<h2>Code map</h2>
			<p>area = lines of code · colour = folder (grouping depth {grouping.depth}) · click a file to open it in the Files tab</p>
		</div>
		<Treemap
			tree={a.tree}
			colorOf={(p) => grouping.colorOf(p, dark)}
			height={400}
			onSelect={(node) => goto(reportHref('files', a.path, { q: node.path }))}
		/>
		<div class="legend row small">
			{#each grouping.groups as g (g.key)}
				<span class="badge"><span class="dot" style:background={g.slot === null ? 'var(--muted)' : series(g.slot, dark)}></span>{g.label} <span class="muted">{g.files}</span></span>
			{/each}
		</div>
	</section>

	<section class="grid grid-3">
		<div class="card">
			<div class="card-head"><h2>Project</h2>{#if a.project.license}<p>{a.project.license}</p>{/if}</div>
			{#if a.project.description}<p class="text-2 desc">{a.project.description}</p>{/if}
			<dl class="facts">
				<dt>Package manager</dt><dd>{a.project.packageManager}</dd>
				<dt>Module type</dt><dd>{a.project.moduleType ?? '–'}</dd>
				{#if a.project.nodeEngine}<dt>Node</dt><dd class="mono">{a.project.nodeEngine}</dd>{/if}
				<dt>Dependencies</dt>
				<dd>
					{a.project.dependencies.filter((d) => d.scope === 'dependencies').length} runtime ·
					{a.project.dependencies.filter((d) => d.scope === 'devDependencies').length} dev
				</dd>
				{#if a.project.tsconfig}
					<dt>TypeScript</dt>
					<dd>
						strict {a.project.tsconfig.strict === null ? 'unset' : a.project.tsconfig.strict ? 'on' : 'off'}{a.project.tsconfig.target ? ` · ${a.project.tsconfig.target}` : ''}{a.project.tsconfig.hasPaths ? ' · path aliases' : ''}
					</dd>
				{/if}
			</dl>
			{#if frameworksByCategory.length}
				<h3 class="sub">Stack</h3>
				<div class="row small">
					{#each frameworksByCategory as fw (fw.name)}
						<span class="badge" title={fw.category}>{fw.name} <span class="muted">{fw.version.replace(/^[\^~]/, '')}</span></span>
					{/each}
				</div>
			{/if}
			{#if scriptEntries.length}
				<h3 class="sub">Scripts</h3>
				<ul class="list scripts">
					{#each showAllScripts ? scriptEntries : scriptEntries.slice(0, 6) as [name, cmd] (name)}
						<li><span class="mono">{name}</span><span class="mono muted cmd" title={cmd}>{cmd}</span></li>
					{/each}
				</ul>
				{#if scriptEntries.length > 6}
					<button class="link-btn" type="button" onclick={() => (showAllScripts = !showAllScripts)}>
						{showAllScripts ? 'Show fewer' : `Show all ${scriptEntries.length} scripts`}
					</button>
				{/if}
			{/if}
			{#if a.project.configFiles.length}
				<h3 class="sub">Config & meta files</h3>
				<div class="row small">
					{#each a.project.configFiles as f (f)}
						<span class="badge mono">{f}</span>
					{/each}
				</div>
			{/if}
		</div>

		<div class="card">
			<div class="card-head"><h2>Structure</h2><p><a href={reportHref('graph', a.path)}>open import graph →</a></p></div>
			<h3 class="sub">Most imported files</h3>
			{#if hubs.length}
				<ul class="list">
					{#each hubs as h (h.path)}
						<li><a class="path" href={reportHref('graph', a.path, { node: h.path })} title={h.path}>{shortPath(h.path, 44)}</a><span class="num muted">{h.inDegree}</span></li>
					{/each}
				</ul>
			{:else}
				<p class="muted small">No internal imports found.</p>
			{/if}
			<h3 class="sub">Entry points <span class="muted">(import others, imported by none)</span></h3>
			{#if entries.length}
				<ul class="list">
					{#each entries as e (e)}
						<li><a class="path" href={reportHref('graph', a.path, { node: e })} title={e}>{shortPath(e, 48)}</a></li>
					{/each}
				</ul>
			{:else}
				<p class="muted small">None.</p>
			{/if}
			<dl class="facts top">
				<dt>Circular dependencies</dt><dd>{a.graph.cycles.length}</dd>
				<dt>Orphan files</dt><dd>{a.graph.orphans.length} <span class="muted">(no imports either way)</span></dd>
				<dt>External packages</dt><dd>{a.externals.filter((e) => !e.builtin && !e.virtual).length}</dd>
			</dl>
		</div>

		<div class="card">
			<div class="card-head"><h2>Largest files</h2><p><a href={reportHref('files', a.path)}>all files →</a></p></div>
			<ul class="list">
				{#each largest as f (f.path)}
					<li>
						<a class="path" href={reportHref('files', a.path, { q: f.path })} title={f.path}>{shortPath(f.path, 44)}</a>
						<span class="num muted">{fmt(f.loc)}</span>
					</li>
				{/each}
			</ul>
			<h3 class="sub">Function complexity</h3>
			<Chart type="bar" data={complexityData} height={170} title="Function complexity distribution" />
		</div>
	</section>

	{#if a.git}
		<section class="card git-strip">
			<div class="card-head"><h2>Git at a glance</h2><p><a href={reportHref('git', a.path)}>full git statistics →</a></p></div>
			<div class="tiles">
				<StatTile label="Commits" value={fmt(a.git.totalCommits)} hint="{fmt(a.git.commitsLast365d)} in the last year" />
				<StatTile label="Contributors" value={fmt(a.git.authors.length)} hint="{a.git.activeAuthorsLast90d} active in last 90 days" />
				<StatTile label="Last commit" value={ago(a.git.lastCommit)} hint={a.git.recentCommits[0]?.subject} />
				<StatTile label="First commit" value={ago(a.git.firstCommit)} hint="repository age" />
				<StatTile label="Single-author files" value={pct(a.git.singleAuthorFiles / Math.max(1, a.git.filesWithHistory))} hint="knowledge concentrated in one person" tone={a.git.singleAuthorFiles / Math.max(1, a.git.filesWithHistory) > 0.7 ? 'warn' : 'neutral'} />
				<StatTile label="Uncommitted changes" value={fmt(a.git.uncommittedChanges)} hint="files in working tree" tone={a.git.uncommittedChanges ? 'warn' : 'good'} />
			</div>
		</section>
	{/if}
</div>

<style>
	.legend {
		margin-top: 10px;
	}
	.desc {
		margin-bottom: 10px;
	}
	.facts {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 4px 14px;
		margin: 0;
		font-size: 13px;
	}
	.facts.top {
		margin-top: 12px;
	}
	.facts dt {
		color: var(--muted);
	}
	.facts dd {
		margin: 0;
	}
	.sub {
		margin: 14px 0 6px;
	}
	.scripts .cmd {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 60%;
	}
	.link-btn {
		background: none;
		border: 0;
		padding: 4px 0;
		color: var(--accent);
		font-size: 12.5px;
	}
	.git-strip .tiles {
		grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
	}
</style>
