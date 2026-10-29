<script lang="ts">
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';
	import { ago, duration, reportHref } from '#lib/format.js';

	let { data, children }: LayoutProps = $props();
	const a = $derived(data.analysis);

	const tabs = [
		{ id: '', label: 'Overview' },
		{ id: 'files', label: 'Files' },
		{ id: 'graph', label: 'Import graph' },
		{ id: 'dependencies', label: 'Dependencies' },
		{ id: 'git', label: 'Git' },
		{ id: 'hotspots', label: 'Hotspots & quality' }
	];
	const current = $derived(page.url.pathname.replace(/^\/report\/?/, '').split('/')[0] ?? '');
	const topFrameworks = $derived(
		a.project.frameworks.filter((f) => f.category !== 'lint' && f.category !== 'style').slice(0, 6)
	);
</script>

<svelte:head>
	<title>{a.name} · Code Analyzer</title>
</svelte:head>

<div class="report-head">
	<div class="title">
		<h1>
			{a.name}
			{#if a.project.version}<span class="version">v{a.project.version}</span>{/if}
		</h1>
		<div class="path mono small text-2" title={a.path}>{a.path}</div>
		<div class="row badges">
			{#each topFrameworks as fw (fw.name)}
				<span class="badge" title="{fw.category} · {fw.version}">{fw.name}</span>
			{/each}
			{#if a.project.packageManager !== 'unknown'}<span class="badge">{a.project.packageManager}</span>{/if}
			{#if a.project.isMonorepo}<span class="badge">monorepo</span>{/if}
			{#if a.git}
				<span class="badge" title="git branch">⎇ {a.git.branch}</span>
			{:else}
				<span class="badge muted" title={a.gitError ?? ''}>no git history</span>
			{/if}
		</div>
	</div>
	<div class="meta small muted">
		<div>Analyzed {ago(a.analyzedAt)} in {duration(a.durationMs)} · {a.scanMethod === 'git' ? 'files from git index' : 'files from directory walk'}</div>
		<div class="row">
			<a href={reportHref(current, a.path, { refresh: '1' })} data-sveltekit-preload-data="false">Re-analyze</a>
			<span>·</span>
			<a href="/api/analyze?path={encodeURIComponent(a.path)}" target="_blank" rel="noopener">Raw JSON</a>
			<span>·</span>
			<a href="/">Choose another project</a>
		</div>
	</div>
</div>

{#if a.warnings.length}
	<div class="stack warnings">
		{#each a.warnings as w, i (i)}
			<div class="notice">{w}</div>
		{/each}
	</div>
{/if}

<nav class="tabs" aria-label="Report sections">
	{#each tabs as tab (tab.id)}
		<a class:active={current === tab.id} href={reportHref(tab.id, a.path)} aria-current={current === tab.id ? 'page' : undefined}>
			{tab.label}
		</a>
	{/each}
</nav>

{@render children()}

<style>
	.report-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 20px;
		margin-bottom: 16px;
		flex-wrap: wrap;
	}
	.title {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}
	.version {
		color: var(--muted);
		font-weight: 500;
		font-size: 16px;
		margin-left: 6px;
	}
	.path {
		word-break: break-all;
	}
	.badges {
		margin-top: 2px;
	}
	.meta {
		text-align: right;
		display: flex;
		flex-direction: column;
		gap: 4px;
		align-items: flex-end;
	}
	.meta .row {
		gap: 6px;
	}
	.warnings {
		margin-bottom: 14px;
		gap: 8px;
	}
	.tabs {
		display: flex;
		gap: 4px;
		border-bottom: 1px solid var(--border);
		margin-bottom: 20px;
		overflow-x: auto;
	}
	.tabs a {
		padding: 9px 14px;
		color: var(--text-2);
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		white-space: nowrap;
		font-size: 13.5px;
	}
	.tabs a:hover {
		color: var(--text);
		text-decoration: none;
	}
	.tabs a.active {
		color: var(--text);
		border-bottom-color: var(--accent);
		font-weight: 600;
	}
	@media (max-width: 800px) {
		.meta {
			align-items: flex-start;
			text-align: left;
		}
	}
</style>
