<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { navigating } from '$app/state';
	import { fmt, reportHref } from '#lib/format.js';
	import type { AnalysisProgress } from '#lib/types.js';
	import type { BrowseResponse } from './api/browse/+server';

	const RECENTS_KEY = 'code-analyzer-recent-paths';

	let path = $state('');
	let browse = $state<BrowseResponse | null>(null);
	let browseError = $state<string | null>(null);
	let showHidden = $state(false);
	let recents = $state<string[]>([]);
	let elapsed = $state(0);
	let progress = $state<AnalysisProgress | null>(null);
	let choosing = $state(false);
	/** The typed path the folder list was last pointed at, so typing pauses do not refetch it. */
	let followed = '';
	let dialogRequest: AbortController | null = null;

	const analyzing = $derived(navigating.to?.url.pathname.startsWith('/report') ?? false);
	/** Folder of the pending analysis, taken from the navigation so the "recent" links are covered too. */
	const analyzingPath = $derived(analyzing ? (navigating.to?.url.searchParams.get('path') ?? null) : null);
	const percent = $derived(Math.round((progress?.fraction ?? 0) * 100));
	const stepText = $derived(describeStep(progress));

	$effect(() => {
		if (!analyzing) {
			elapsed = 0;
			return;
		}
		const started = Date.now();
		const id = setInterval(() => (elapsed = Math.round((Date.now() - started) / 1000)), 500);
		return () => clearInterval(id);
	});

	// Follow the server-side progress of the pending analysis (server-sent events from /api/analyze/progress).
	$effect(() => {
		progress = null;
		if (!analyzingPath) return;
		const source = new EventSource(`/api/analyze/progress?path=${encodeURIComponent(analyzingPath)}`);
		source.onmessage = (event) => {
			let next: AnalysisProgress;
			try {
				next = JSON.parse(event.data) as AnalysisProgress;
			} catch {
				return;
			}
			// Never move the bar backwards, e.g. after the browser reconnects the stream.
			if (!progress || next.fraction >= progress.fraction || next.phase === 'error') progress = next;
			if (next.phase === 'done' || next.phase === 'error') source.close();
		};
		return () => source.close();
	});

	function describeStep(p: AnalysisProgress | null): string {
		if (!p) return 'Starting…';
		if (p.phase === 'done') return 'Done';
		if (p.phase === 'error') return p.error ?? p.message;
		if (p.done !== null && p.total !== null) return `${p.message} · ${fmt(p.done)} of ${fmt(p.total)}`;
		return `${p.message}…`;
	}

	function loadRecents() {
		try {
			const raw = localStorage.getItem(RECENTS_KEY);
			recents = raw ? (JSON.parse(raw) as string[]) : [];
		} catch {
			recents = [];
		}
	}

	function saveRecent(p: string) {
		const next = [p, ...recents.filter((r) => r !== p)].slice(0, 8);
		recents = next;
		try {
			localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
		} catch {
			/* ignore */
		}
	}

	function removeRecent(p: string) {
		recents = recents.filter((r) => r !== p);
		try {
			localStorage.setItem(RECENTS_KEY, JSON.stringify(recents));
		} catch {
			/* ignore */
		}
	}

	/**
	 * Point the folder list at `target`. Quiet loads follow what is being typed: they leave the input
	 * and any earlier error alone, and a path that cannot be read is simply not shown.
	 */
	async function loadBrowse(target?: string, quiet = false) {
		if (!quiet) browseError = null;
		const params = new URLSearchParams();
		if (target) params.set('path', target);
		if (showHidden) params.set('hidden', '1');
		try {
			const res = await fetch(`/api/browse?${params}`);
			const json = (await res.json()) as BrowseResponse;
			if (!res.ok || json.error) {
				if (!quiet) browseError = json.error ?? `Could not read ${target}`;
				return;
			}
			browse = json;
			if (quiet) {
				followed = target ?? '';
			} else {
				path = json.path;
				followed = json.path;
			}
		} catch (err) {
			if (!quiet) browseError = (err as Error).message;
		}
	}

	// Once typing pauses, show the typed folder in the list below (quietly: half-typed paths are not errors).
	$effect(() => {
		const typed = path.trim();
		if (!typed || typed === followed) return;
		const id = setTimeout(() => loadBrowse(typed, true), 400);
		return () => clearTimeout(id);
	});

	// Leaving the page closes a folder dialog that is still open.
	$effect(() => () => dialogRequest?.abort());

	/** Open the operating system's folder dialog (on the machine running the server) and take its choice. */
	async function chooseFolder() {
		choosing = true;
		browseError = null;
		dialogRequest = new AbortController();
		try {
			const res = await fetch('/api/choose-folder', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ path: path.trim() }),
				signal: dialogRequest.signal
			});
			const json = (await res.json()) as { path?: string; cancelled?: boolean; error?: string; unsupported?: boolean };
			if (json.unsupported) {
				// No native dialog on this system: the folder list below is the way to browse.
				await loadBrowse(path);
				browseError ??= `${json.error} Pick a folder from the list below instead.`;
			} else if (!res.ok || json.error) {
				browseError = json.error ?? 'Could not open the folder dialog.';
			} else if (json.path) {
				path = json.path;
				await loadBrowse(json.path);
			}
		} catch (err) {
			if (!(err instanceof DOMException && err.name === 'AbortError')) browseError = (err as Error).message;
		} finally {
			dialogRequest = null;
			choosing = false;
		}
	}

	function analyze(target = path) {
		const trimmed = target.trim();
		if (!trimmed) return;
		saveRecent(trimmed);
		goto(reportHref('', trimmed));
	}

	onMount(() => {
		loadRecents();
		loadBrowse(recents[0] ? recents[0] : undefined);
	});
</script>

<svelte:head>
	<title>Code Analyzer · choose a project</title>
</svelte:head>

<section class="hero">
	<h1>Understand a JavaScript or TypeScript project at a glance</h1>
	<p class="text-2">
		Point the analyzer at a folder on this machine. Every <code>.js</code>, <code>.ts</code>, <code>.jsx</code>,
		<code>.tsx</code> file (plus the script blocks of <code>.svelte</code> and <code>.vue</code> components) is parsed
		with tree-sitter to measure size, functions, complexity and imports. The import graph, external dependencies and
		git history are turned into charts you can explore.
	</p>
</section>

<form
	class="card picker"
	onsubmit={(e) => {
		e.preventDefault();
		analyze();
	}}
>
	<label class="field">
		<span class="label">Project folder</span>
		<div class="row nowrap">
			<input class="input path" type="text" bind:value={path} placeholder="/Users/you/projects/my-app" spellcheck="false" autocomplete="off" />
			<button class="btn" type="button" onclick={chooseFolder} disabled={choosing || analyzing} title="Choose a folder with the system dialog">
				{choosing ? 'Choosing…' : 'Browse…'}
			</button>
			<button class="btn btn-primary" type="submit" disabled={analyzing || !path.trim()}>
				{analyzing ? 'Analyzing…' : 'Analyze'}
			</button>
		</div>
	</label>

	{#if analyzing}
		<div class="notice notice-info progress">
			<div class="progress-row">
				<span class="progress-title">Analyzing <code>{analyzingPath}</code></span>
				<span class="mono muted">{elapsed}s</span>
			</div>
			<div
				class="track"
				role="progressbar"
				aria-label="Analysis progress"
				aria-valuemin="0"
				aria-valuemax="100"
				aria-valuenow={percent}
				aria-valuetext="{percent}% · {stepText}"
			>
				<div class="fill" style:width="{percent}%"></div>
			</div>
			<div class="progress-row small">
				<span class="text-2">{stepText}</span>
				<span class="mono muted pct">{percent}%</span>
			</div>
			<span class="sr-only" aria-live="polite">{progress?.message ?? ''}</span>
			<p class="small muted">Large repositories with long git histories can take a while.</p>
		</div>
	{/if}

	<div class="browser">
		<div class="browser-head">
			<div class="crumbs mono small">
				{#if browse}
					{#if browse.parent}
						<button class="link" type="button" onclick={() => loadBrowse(browse!.parent!)} title="Go to parent folder">↑ up</button>
						<span class="muted"> · </span>
					{/if}
					<span>{browse.path}</span>
					{#if browse.isProject}<span class="badge badge-good">package.json</span>{/if}
				{:else}
					<span class="muted">Loading…</span>
				{/if}
			</div>
			<label class="small muted">
				<input type="checkbox" bind:checked={showHidden} onchange={() => loadBrowse(path)} /> hidden folders
			</label>
		</div>
		{#if browseError}
			<div class="notice">{browseError}</div>
		{:else if browse}
			{#if browse.entries.length === 0}
				<div class="empty">No sub-folders here.</div>
			{:else}
				<ul class="folders">
					{#each browse.entries as entry (entry.path)}
						<li>
							<button class="folder" type="button" onclick={() => loadBrowse(entry.path)} title={entry.path}>
								<span class="icon" aria-hidden="true">▸</span>
								<span class="name">{entry.name}</span>
								{#if entry.hasPackageJson}<span class="tag">pkg</span>{/if}
								{#if entry.isGitRepo}<span class="tag">git</span>{/if}
							</button>
							{#if entry.hasPackageJson || entry.isGitRepo}
								<button class="link small" type="button" onclick={() => analyze(entry.path)}>analyze</button>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</div>
</form>

{#if recents.length}
	<section class="card recents">
		<div class="card-head">
			<h2>Recent projects</h2>
		</div>
		<ul class="list">
			{#each recents as r (r)}
				<li>
					<a class="path" href={reportHref('', r)} onclick={() => saveRecent(r)}>{r}</a>
					<button class="link small" type="button" onclick={() => removeRecent(r)} aria-label="Remove {r} from recent projects">remove</button>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<section class="features">
	<div class="card">
		<h3>Code metrics</h3>
		<p class="text-2">Lines of code, comments, functions, classes, exports, cyclomatic complexity and nesting depth for every file.</p>
	</div>
	<div class="card">
		<h3>Import graph</h3>
		<p class="text-2">An interactive force-directed graph of file dependencies, with hubs, entry points, circular dependencies and orphans.</p>
	</div>
	<div class="card">
		<h3>Git history</h3>
		<p class="text-2">Commit timeline, contributors, activity heatmap, code churn, ownership and bus-factor indicators.</p>
	</div>
	<div class="card">
		<h3>Hotspots & quality</h3>
		<p class="text-2">Files that are both complex and frequently changed, long functions, <code>any</code> usage, TODOs and more.</p>
	</div>
</section>

<style>
	.hero {
		max-width: 820px;
		margin: 10px auto 26px;
		text-align: center;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.hero h1 {
		font-size: 28px;
	}
	.picker {
		max-width: 820px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.label {
		font-size: 12.5px;
		color: var(--text-2);
		font-weight: 600;
	}
	.nowrap {
		flex-wrap: nowrap;
	}
	.path {
		flex: 1;
		font-family: var(--mono);
	}
	.progress {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.progress-row {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 12px;
	}
	.progress-title {
		min-width: 0;
		word-break: break-all;
	}
	.pct {
		font-variant-numeric: tabular-nums;
	}
	.track {
		position: relative;
		height: 8px;
		border-radius: 999px;
		background: var(--surface-3);
		overflow: hidden;
	}
	/* A sweep over the unfilled part shows the analysis is alive between count updates. */
	.track::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(90deg, transparent, color-mix(in oklab, var(--accent) 28%, transparent), transparent);
		animation: sweep 1.6s ease-in-out infinite;
	}
	.fill {
		position: relative;
		z-index: 1;
		height: 100%;
		border-radius: inherit;
		background: var(--accent);
		transition: width 0.3s ease-out;
	}
	@keyframes sweep {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(100%);
		}
	}
	.browser {
		border: 1px solid var(--grid);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}
	.browser-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 10px;
		padding: 8px 12px;
		background: var(--surface-2);
		border-bottom: 1px solid var(--grid);
	}
	.crumbs {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
		min-width: 0;
		word-break: break-all;
	}
	.link {
		background: none;
		border: 0;
		padding: 0;
		color: var(--accent);
		font: inherit;
	}
	.link:hover {
		text-decoration: underline;
	}
	.folders {
		list-style: none;
		margin: 0;
		padding: 4px 0;
		max-height: 300px;
		overflow: auto;
		columns: 2;
	}
	.folders li {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 2px 12px;
		break-inside: avoid;
	}
	.folder {
		display: flex;
		align-items: center;
		gap: 6px;
		background: none;
		border: 0;
		padding: 4px 6px;
		border-radius: 4px;
		min-width: 0;
		flex: 1;
		text-align: left;
	}
	.folder:hover {
		background: var(--surface-2);
	}
	.folder .name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.icon {
		color: var(--muted);
	}
	.tag {
		font-size: 10px;
		padding: 0 5px;
		border-radius: 999px;
		background: var(--accent-soft);
		color: var(--accent);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.recents {
		max-width: 820px;
		margin: 16px auto 0;
	}
	.features {
		max-width: 1000px;
		margin: 36px auto 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
		gap: 14px;
	}
	.features h3 {
		margin-bottom: 6px;
	}
	@media (max-width: 700px) {
		.folders {
			columns: 1;
		}
	}
</style>
