<script lang="ts">
	import type { PageProps } from './$types';
	import type { DeclaredDependency, ExternalPackage } from '#lib/types.js';
	import { cellText, type Column } from '#lib/table.js';
	import Chart from '#lib/components/Chart.svelte';
	import DataTable from '#lib/components/DataTable.svelte';
	import StatTile from '#lib/components/StatTile.svelte';
	import { theme } from '#lib/theme.svelte.js';
	import { series } from '#lib/colors.js';
	import { fmt, reportHref } from '#lib/format.js';

	let { data }: PageProps = $props();
	const a = $derived(data.analysis);
	const dark = $derived(theme.isDark);

	const packages = $derived(a.externals.filter((e) => !e.builtin && !e.virtual));
	const selfImports = $derived(packages.filter((e) => e.self));
	const builtins = $derived(a.externals.filter((e) => e.builtin));
	const virtuals = $derived(a.externals.filter((e) => e.virtual));
	const undeclared = $derived(packages.filter((e) => !e.declared && !e.self));
	const runtimeDeps = $derived(a.project.dependencies.filter((d) => d.scope === 'dependencies'));
	const devDeps = $derived(a.project.dependencies.filter((d) => d.scope === 'devDependencies'));
	const notImported = $derived(
		a.project.dependencies.filter((d) => d.importCount === 0 && (d.scope === 'dependencies' || d.scope === 'devDependencies'))
	);
	const devUsedInSource = $derived(
		packages.filter((e) => e.declared === 'devDependencies' && !e.typeOnly && e.files.some((f) => !isTestOrConfig(f)))
	);

	function isTestOrConfig(path: string): boolean {
		const f = a.files.find((x) => x.path === path);
		return !f || f.isTest || !path.includes('/') || /\.(config|setup)\.[cm]?[jt]sx?$/.test(path);
	}

	const top = $derived(packages.slice(0, 15));
	const chartData = $derived({
		labels: top.map((p) => p.name),
		datasets: [{ label: 'Import statements', data: top.map((p) => p.importCount), backgroundColor: series(0, dark) }]
	});
	const horizontal = {
		indexAxis: 'y' as const,
		scales: { x: { beginAtZero: true }, y: { grid: { display: false }, ticks: { autoSkip: false, font: { size: 11 } } } }
	};

	const scopeLabel: Record<string, string> = {
		dependencies: 'dependency',
		devDependencies: 'dev',
		peerDependencies: 'peer',
		optionalDependencies: 'optional'
	};

	const columns: Column<ExternalPackage>[] = [
		{ key: 'name', label: 'Package', mono: true },
		{ key: 'importCount', label: 'Imports', align: 'right', hint: 'Import statements across the project' },
		{ key: 'files', label: 'Files', align: 'right', value: (p) => p.files.length },
		{ key: 'declared', label: 'Declared in', value: (p) => p.declared ?? '' , format: (p) => (p.declared ? scopeLabel[p.declared] : 'not declared') },
		{ key: 'declaredVersion', label: 'Version', mono: true, value: (p) => p.declaredVersion ?? '', format: (p) => p.declaredVersion ?? '–' },
		{ key: 'typeOnly', label: 'Usage', value: (p) => (p.typeOnly ? 'types only' : 'runtime'), format: (p) => (p.typeOnly ? 'types only' : 'runtime') }
	];

	const declaredColumns: Column<DeclaredDependency>[] = [
		{ key: 'name', label: 'Package', mono: true },
		{ key: 'scope', label: 'Scope', format: (d) => scopeLabel[d.scope] ?? d.scope },
		{ key: 'version', label: 'Version', mono: true }
	];
</script>

<div class="stack">
	<section class="tiles">
		<StatTile label="External packages imported" value={fmt(packages.length)} hint="{fmt(packages.reduce((n, p) => n + p.importCount, 0))} import statements" />
		<StatTile label="Declared dependencies" value={fmt(runtimeDeps.length)} hint="{fmt(devDeps.length)} devDependencies" />
		<StatTile label="Declared but never imported" value={fmt(notImported.length)} hint="CLI tools, plugins and @types are expected here" />
		<StatTile label="Imported but not declared" value={fmt(undeclared.length)} hint={undeclared.length ? 'relies on transitive or workspace packages' : 'every import is declared'} tone={undeclared.length ? 'warn' : 'good'} />
		<StatTile label="Dev dependencies in source" value={fmt(devUsedInSource.length)} hint="devDependencies imported by non-test source files" tone={devUsedInSource.length ? 'warn' : 'neutral'} />
		<StatTile label="Node built-ins" value={fmt(builtins.length)} hint={builtins.slice(0, 4).map((b) => b.name).join(', ') + (builtins.length > 4 ? '…' : '')} />
	</section>

	<section class="grid grid-2">
		<div class="card">
			<div class="card-head"><h2>Most imported packages</h2><p>by import statements</p></div>
			{#if top.length}
				<Chart type="bar" data={chartData} height={Math.max(160, top.length * 24 + 40)} title="Most imported external packages" options={horizontal} />
			{:else}
				<p class="muted small">No external packages are imported.</p>
			{/if}
		</div>
		<div class="card">
			<div class="card-head"><h2>Potential issues</h2></div>
			<h3 class="sub">Imported but not declared</h3>
			{#if undeclared.length}
				<p class="small text-2">These packages are imported but missing from package.json. They may be workspace packages, provided by a framework, or transitive dependencies that could break on update.</p>
				<div class="row small" style:margin-top="8px">
					{#each undeclared as p (p.name)}<span class="badge badge-warn mono">{p.name} <span class="muted">{p.importCount}</span></span>{/each}
				</div>
			{:else}
				<p class="muted small">Every imported package is declared.</p>
			{/if}
			<h3 class="sub">Dev dependencies used in source</h3>
			{#if devUsedInSource.length}
				<p class="small text-2">Imported at runtime by non-test files but declared under devDependencies. Fine for bundled front-ends; a problem for published packages or servers.</p>
				<div class="row small" style:margin-top="8px">
					{#each devUsedInSource as p (p.name)}<span class="badge mono">{p.name}</span>{/each}
				</div>
			{:else}
				<p class="muted small">None found.</p>
			{/if}
			{#if selfImports.length}
				<h3 class="sub">Self-imports</h3>
				<p class="small text-2">{selfImports[0].files.length} files import the project by its own package name (<code>{selfImports[0].name}</code>), typically docs, examples or tests.</p>
			{/if}
			{#if virtuals.length}
				<h3 class="sub">Framework virtual modules</h3>
				<div class="row small">
					{#each virtuals as v (v.name)}<span class="badge mono">{v.name} <span class="muted">{v.importCount}</span></span>{/each}
				</div>
			{/if}
			{#if builtins.length}
				<h3 class="sub">Node built-ins</h3>
				<div class="row small">
					{#each builtins as b (b.name)}<span class="badge mono">{b.name} <span class="muted">{b.importCount}</span></span>{/each}
				</div>
			{/if}
		</div>
	</section>

	<section class="card">
		<div class="card-head"><h2>Imported packages</h2><p>click a row to see which files import it</p></div>
		<DataTable rows={packages} {columns} rowKey={(p) => p.name} sortKey="importCount" sortDir="desc" searchable searchPlaceholder="Filter packages…" pageSize={50}>
			{#snippet cell(p: ExternalPackage, col: Column<ExternalPackage>)}
				{#if col.key === 'declared'}
					{#if p.self}
						<span class="badge" title="The project imports itself by its package name">this package</span>
					{:else if p.declared}
						<span class="badge">{scopeLabel[p.declared]}</span>
					{:else}
						<span class="badge badge-warn">not declared</span>
					{/if}
				{:else}
					{cellText(p, col)}
				{/if}
			{/snippet}
			{#snippet expand(p: ExternalPackage)}
				<ul class="list compact cols">
					{#each p.files as f (f)}
						<li><a class="path" href={reportHref('files', a.path, { q: f })}>{f}</a></li>
					{/each}
				</ul>
			{/snippet}
		</DataTable>
	</section>

	{#if notImported.length}
		<section class="card">
			<div class="card-head">
				<h2>Declared but never imported</h2>
				<p>{notImported.length} packages · tools used only from scripts or config (bundlers, linters, type packages, adapters) are expected here</p>
			</div>
			<DataTable rows={notImported} columns={declaredColumns} rowKey={(d) => d.name} sortKey="name" sortDir="asc" pageSize={100} />
		</section>
	{/if}
</div>

<style>
	.sub {
		margin: 12px 0 6px;
	}
	.sub:first-of-type {
		margin-top: 0;
	}
	.cols {
		columns: 2;
	}
	.cols li {
		break-inside: avoid;
		display: block;
		padding: 2px 0;
		border: 0;
	}
</style>
