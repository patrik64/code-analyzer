<script lang="ts">
	import type { PageProps } from './$types';
	import type { GitAuthor, GitFileChurn } from '#lib/types.js';
	import { cellText, type Column } from '#lib/table.js';
	import Chart from '#lib/components/Chart.svelte';
	import DataTable from '#lib/components/DataTable.svelte';
	import Heatmap from '#lib/components/Heatmap.svelte';
	import StatTile from '#lib/components/StatTile.svelte';
	import { theme } from '#lib/theme.svelte.js';
	import { series, withAlpha } from '#lib/colors.js';
	import { ago, compact, fixed, fmt, fmtDate, fmtDateTime, pct, reportHref, shortPath } from '#lib/format.js';

	let { data }: PageProps = $props();
	const a = $derived(data.analysis);
	const g = $derived(a.git);
	const dark = $derived(theme.isDark);

	const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	function periodLabel(period: string, unit: 'week' | 'month'): string {
		const [y, m, d] = period.split('-').map(Number);
		if (unit === 'month') return `${MONTHS[m - 1]} ${y}`;
		return `${MONTHS[m - 1]} ${d}, ${y}`;
	}

	const timelineData = $derived(
		g
			? {
					labels: g.timeline.map((p) => periodLabel(p.period, g.timelineUnit)),
					datasets: [{ label: 'Commits', data: g.timeline.map((p) => p.commits), backgroundColor: series(0, dark) }]
				}
			: null
	);
	const churnData = $derived(
		g
			? {
					labels: g.timeline.map((p) => periodLabel(p.period, g.timelineUnit)),
					datasets: [
						{ label: 'Lines added', data: g.timeline.map((p) => p.additions), borderColor: series(0, dark), backgroundColor: withAlpha(series(0, dark), 0.12), fill: true },
						{ label: 'Lines deleted', data: g.timeline.map((p) => p.deletions), borderColor: series(7, dark), backgroundColor: withAlpha(series(7, dark), 0.12), fill: true }
					]
				}
			: null
	);
	const authorsChart = $derived.by(() => {
		if (!g) return null;
		const top = g.authors.slice(0, 10);
		const rest = g.authors.slice(10);
		const labels = top.map((x) => x.name);
		const values = top.map((x) => x.commits);
		if (rest.length) {
			labels.push(`Other (${rest.length})`);
			values.push(rest.reduce((n, x) => n + x.commits, 0));
		}
		return { labels, datasets: [{ label: 'Commits', data: values, backgroundColor: series(0, dark) }] };
	});
	const horizontal = {
		indexAxis: 'y' as const,
		scales: { x: { beginAtZero: true }, y: { grid: { display: false }, ticks: { autoSkip: false, font: { size: 11 } } } }
	};
	const timelineOptions = { scales: { x: { ticks: { maxTicksLimit: 12 } } } };

	const totalCommits = $derived(g ? g.analyzedCommits : 0);
	const authorColumns = $derived<Column<GitAuthor>[]>([
		{ key: 'name', label: 'Contributor', title: (x) => x.email },
		{ key: 'commits', label: 'Commits', align: 'right' },
		{ key: 'share', label: 'Share', align: 'right', value: (x) => x.commits / Math.max(1, totalCommits), format: (x) => pct(x.commits / Math.max(1, totalCommits), 1) },
		{ key: 'additions', label: 'Added', align: 'right', format: (x) => compact(x.additions) },
		{ key: 'deletions', label: 'Deleted', align: 'right', format: (x) => compact(x.deletions) },
		{ key: 'filesTouched', label: 'Files touched', align: 'right' },
		{ key: 'filesOwned', label: 'Files owned', align: 'right', hint: 'Analyzed files where this person made the most commits' },
		{ key: 'activeDays', label: 'Active days', align: 'right' },
		{ key: 'firstCommit', label: 'First', format: (x) => fmtDate(x.firstCommit) },
		{ key: 'lastCommit', label: 'Last', format: (x) => ago(x.lastCommit), title: (x) => fmtDate(x.lastCommit) }
	]);

	const churnColumns: Column<GitFileChurn>[] = [
		{ key: 'path', label: 'File', mono: true },
		{ key: 'commits', label: 'Commits', align: 'right' },
		{ key: 'recentCommits', label: 'Last 12 months', align: 'right' },
		{ key: 'additions', label: 'Added', align: 'right', format: (x) => compact(x.additions) },
		{ key: 'deletions', label: 'Deleted', align: 'right', format: (x) => compact(x.deletions) },
		{ key: 'authors', label: 'Authors', align: 'right' },
		{ key: 'lastModified', label: 'Last change', format: (x) => ago(x.lastModified), title: (x) => fmtDate(x.lastModified) }
	];

	const topShare = $derived(g && g.authors.length ? g.authors[0].commits / Math.max(1, g.analyzedCommits) : 0);
	const singleAuthorRatio = $derived(g ? g.singleAuthorFiles / Math.max(1, g.filesWithHistory) : 0);
	const ageDays = $derived(g ? (new Date(g.lastCommit).getTime() - new Date(g.firstCommit).getTime()) / 86400000 : 0);
</script>

{#if !g}
	<div class="card">
		<h2>No git statistics</h2>
		<p class="text-2" style:margin-top="8px">{a.gitError ?? 'This folder is not inside a git repository.'}</p>
	</div>
{:else}
	<div class="stack">
		{#if g.scopedToSubdir}
			<div class="notice notice-info">
				The analysed folder is <code>{g.scopedToSubdir}</code> inside the repository at <code>{g.root}</code>; statistics only include commits touching this folder.
			</div>
		{/if}
		<section class="tiles">
			<StatTile label="Commits" value={fmt(g.totalCommits)} hint={g.truncated ? `most recent ${fmt(g.analyzedCommits)} analysed` : `${fmt(g.mergeCommits)} merges`} />
			<StatTile label="Contributors" value={fmt(g.authors.length)} hint="{g.activeAuthorsLast90d} active in the last 90 days" />
			<StatTile label="Last commit" value={ago(g.lastCommit)} hint={fmtDateTime(g.lastCommit)} />
			<StatTile label="Repository age" value={ageDays > 365 ? `${fixed(ageDays / 365.25, 1)} years` : `${Math.round(ageDays)} days`} hint="first commit {fmtDate(g.firstCommit)}" />
			<StatTile label="Last 30 days" value={fmt(g.commitsLast30d)} hint="{fmt(g.commitsLast90d)} in 90 days · {fmt(g.commitsLast365d)} in a year" />
			<StatTile label="Branch" value={g.branch} hint={g.remote ?? 'no remote'} title={g.remote ?? ''} />
			<StatTile label="Tags" value={fmt(g.tagCount)} hint={g.latestTag ? `latest ${g.latestTag}` : undefined} />
			<StatTile label="Uncommitted changes" value={fmt(g.uncommittedChanges)} hint="files modified, added or untracked" tone={g.uncommittedChanges ? 'warn' : 'good'} />
			<StatTile label="Avg commit size" value="{fixed(g.avgFilesPerCommit, 1)} files" hint="{fmt(Math.round(g.avgLinesPerCommit))} lines changed (non-merge)" />
			<StatTile label="Top contributor share" value={pct(topShare)} hint={g.authors[0]?.name} tone={topShare > 0.8 && g.authors.length > 1 ? 'warn' : 'neutral'} />
			<StatTile label="Single-author files" value={pct(singleAuthorRatio)} hint="{fmt(g.singleAuthorFiles)} of {fmt(g.filesWithHistory)} files with history" tone={singleAuthorRatio > 0.7 ? 'warn' : 'neutral'} />
		</section>

		<section class="grid grid-2">
			<div class="card">
				<div class="card-head"><h2>Commits over time</h2><p>per {g.timelineUnit}</p></div>
				{#if timelineData}<Chart type="bar" data={timelineData} height={260} title="Commits per {g.timelineUnit}" options={timelineOptions} />{/if}
			</div>
			<div class="card">
				<div class="card-head"><h2>Lines added and deleted</h2><p>per {g.timelineUnit}</p></div>
				{#if churnData}<Chart type="line" data={churnData} height={260} title="Lines added and deleted per {g.timelineUnit}" options={timelineOptions} />{/if}
			</div>
		</section>

		<section class="grid grid-2">
			<div class="card">
				<div class="card-head"><h2>Commits by contributor</h2><p>top 10</p></div>
				{#if authorsChart}<Chart type="bar" data={authorsChart} height={Math.max(180, authorsChart.labels.length * 26 + 40)} title="Commits by contributor" options={horizontal} />{/if}
			</div>
			<div class="card">
				<div class="card-head"><h2>When work happens</h2><p>commits by weekday and hour (author's local time)</p></div>
				<Heatmap matrix={g.activity} />
			</div>
		</section>

		<section class="card">
			<div class="card-head"><h2>Contributors</h2><p>{fmt(g.authors.length)} people · grouped by author name</p></div>
			<DataTable rows={g.authors} columns={authorColumns} rowKey={(x) => x.email + x.name} sortKey="commits" sortDir="desc" searchable searchPlaceholder="Filter contributors…" pageSize={25} />
		</section>

		<section class="grid grid-2">
			<div class="card">
				<div class="card-head"><h2>Most changed files</h2><p>code churn · high churn plus high complexity marks a <a href={reportHref('hotspots', a.path)}>hotspot</a></p></div>
				<DataTable rows={g.fileChurn} columns={churnColumns} rowKey={(x) => x.path} sortKey="commits" sortDir="desc" pageSize={15}>
					{#snippet cell(x: GitFileChurn, col: Column<GitFileChurn>)}
						{#if col.key === 'path'}
							<a class="path" href={reportHref('files', a.path, { q: x.path })} title={x.path}>{shortPath(x.path, 46)}</a>
						{:else}
							{cellText(x, col)}
						{/if}
					{/snippet}
				</DataTable>
			</div>
			<div class="card">
				<div class="card-head"><h2>Recent commits</h2><p>latest {g.recentCommits.length}</p></div>
				<ul class="commits">
					{#each g.recentCommits as c (c.hash)}
						<li>
							<div class="subject" title={c.subject}>{c.subject}</div>
							<div class="meta small muted">
								<span class="mono">{c.shortHash}</span> · {c.author} · <span title={fmtDateTime(c.date)}>{ago(c.date)}</span>
								{#if c.isMerge}· merge{:else}· {c.files} file{c.files === 1 ? '' : 's'} <span class="add">+{fmt(c.additions)}</span> <span class="del">−{fmt(c.deletions)}</span>{/if}
							</div>
						</li>
					{/each}
				</ul>
			</div>
		</section>
	</div>
{/if}

<style>
	.commits {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 560px;
		overflow: auto;
	}
	.commits li {
		padding: 7px 0;
		border-bottom: 1px solid var(--grid);
	}
	.commits li:last-child {
		border-bottom: 0;
	}
	.subject {
		font-size: 13px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.add {
		color: var(--good-text);
	}
	.del {
		color: var(--critical);
	}
</style>
