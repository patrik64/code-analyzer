<script lang="ts">
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import { theme } from '#lib/theme.svelte.js';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
	const modeLabel = $derived(theme.mode === 'system' ? 'Auto' : theme.mode === 'light' ? 'Light' : 'Dark');
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Code Analyzer</title>
</svelte:head>

<header class="topbar">
	<div class="container inner">
		<a href="/" class="brand">
			<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
				<circle cx="4" cy="10" r="3" fill="var(--series-1)" />
				<circle cx="14" cy="4" r="3" fill="var(--series-2)" />
				<circle cx="15" cy="15" r="3" fill="var(--series-3)" />
				<path d="M6.5 8.5 11.5 5.5M6.6 11.4 12.3 14.2M14 7v5" stroke="var(--muted)" stroke-width="1.5" fill="none" />
			</svg>
			Code Analyzer
		</a>
		<button class="btn theme" type="button" onclick={() => theme.cycle()} title="Switch colour theme (auto → light → dark)">
			{modeLabel} theme
		</button>
	</div>
</header>

<main class="container page">
	{@render children()}
</main>

<style>
	.topbar {
		border-bottom: 1px solid var(--border);
		background: var(--surface);
		position: sticky;
		top: 0;
		z-index: 20;
	}
	.inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 50px;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-weight: 600;
		color: var(--text);
		font-size: 15px;
	}
	.brand:hover {
		text-decoration: none;
	}
	.theme {
		padding: 5px 10px;
		font-size: 12.5px;
	}
	.page {
		padding-top: 22px;
		padding-bottom: 60px;
	}
</style>
