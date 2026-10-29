import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { DeclaredDependency, DependencyScope, FrameworkInfo, ProjectInfo } from '#lib/types.js';
import type { TsConfigSummary } from './resolve';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PackageJson = Record<string, any>;

const KNOWN_FRAMEWORKS: [pkg: string, label: string, category: FrameworkInfo['category']][] = [
	['react', 'React', 'ui'],
	['preact', 'Preact', 'ui'],
	['vue', 'Vue', 'ui'],
	['svelte', 'Svelte', 'ui'],
	['solid-js', 'Solid', 'ui'],
	['lit', 'Lit', 'ui'],
	['@angular/core', 'Angular', 'framework'],
	['next', 'Next.js', 'meta-framework'],
	['nuxt', 'Nuxt', 'meta-framework'],
	['@sveltejs/kit', 'SvelteKit', 'meta-framework'],
	['astro', 'Astro', 'meta-framework'],
	['@remix-run/react', 'Remix', 'meta-framework'],
	['gatsby', 'Gatsby', 'meta-framework'],
	['@tanstack/react-start', 'TanStack Start', 'meta-framework'],
	['react-router', 'React Router', 'framework'],
	['express', 'Express', 'framework'],
	['fastify', 'Fastify', 'framework'],
	['koa', 'Koa', 'framework'],
	['hono', 'Hono', 'framework'],
	['@nestjs/core', 'NestJS', 'framework'],
	['@hapi/hapi', 'hapi', 'framework'],
	['electron', 'Electron', 'runtime'],
	['react-native', 'React Native', 'framework'],
	['expo', 'Expo', 'framework'],
	['@tauri-apps/api', 'Tauri', 'runtime'],
	['typescript', 'TypeScript', 'build'],
	['vite', 'Vite', 'build'],
	['webpack', 'webpack', 'build'],
	['rollup', 'Rollup', 'build'],
	['esbuild', 'esbuild', 'build'],
	['@swc/core', 'SWC', 'build'],
	['tsup', 'tsup', 'build'],
	['parcel', 'Parcel', 'build'],
	['turbo', 'Turborepo', 'build'],
	['nx', 'Nx', 'build'],
	['lerna', 'Lerna', 'build'],
	['jest', 'Jest', 'test'],
	['vitest', 'Vitest', 'test'],
	['mocha', 'Mocha', 'test'],
	['ava', 'AVA', 'test'],
	['@playwright/test', 'Playwright', 'test'],
	['cypress', 'Cypress', 'test'],
	['@testing-library/react', 'Testing Library', 'test'],
	['storybook', 'Storybook', 'test'],
	['tailwindcss', 'Tailwind CSS', 'style'],
	['sass', 'Sass', 'style'],
	['styled-components', 'styled-components', 'style'],
	['@emotion/react', 'Emotion', 'style'],
	['postcss', 'PostCSS', 'style'],
	['prisma', 'Prisma', 'data'],
	['@prisma/client', 'Prisma', 'data'],
	['drizzle-orm', 'Drizzle', 'data'],
	['typeorm', 'TypeORM', 'data'],
	['mongoose', 'Mongoose', 'data'],
	['sequelize', 'Sequelize', 'data'],
	['graphql', 'GraphQL', 'data'],
	['@apollo/client', 'Apollo Client', 'data'],
	['@tanstack/react-query', 'TanStack Query', 'data'],
	['redux', 'Redux', 'data'],
	['@reduxjs/toolkit', 'Redux Toolkit', 'data'],
	['zustand', 'Zustand', 'data'],
	['mobx', 'MobX', 'data'],
	['zod', 'Zod', 'data'],
	['axios', 'Axios', 'data'],
	['socket.io', 'Socket.IO', 'data'],
	['eslint', 'ESLint', 'lint'],
	['prettier', 'Prettier', 'lint'],
	['@biomejs/biome', 'Biome', 'lint']
];

const CONFIG_FILE_PATTERNS: RegExp[] = [
	/^tsconfig(\..+)?\.json$/,
	/^jsconfig\.json$/,
	/^\.eslintrc(\..+)?$/,
	/^eslint\.config\.[cm]?[jt]s$/,
	/^\.prettierrc(\..+)?$/,
	/^prettier\.config\.[cm]?[jt]s$/,
	/^\.?[\w.-]+\.config\.[cm]?[jt]s$/,
	/^\.babelrc(\..+)?$/,
	/^babel\.config\.[cm]?[jt]s$/,
	/^\.editorconfig$/,
	/^\.nvmrc$/,
	/^\.node-version$/,
	/^\.npmrc$/,
	/^\.yarnrc(\.yml)?$/,
	/^pnpm-workspace\.yaml$/,
	/^turbo\.json$/,
	/^nx\.json$/,
	/^lerna\.json$/,
	/^renovate\.json$/,
	/^\.gitlab-ci\.yml$/,
	/^Dockerfile(\..+)?$/,
	/^docker-compose(\..+)?\.ya?ml$/,
	/^compose\.ya?ml$/,
	/^vercel\.json$/,
	/^netlify\.toml$/,
	/^wrangler\.(toml|jsonc?)$/,
	/^fly\.toml$/,
	/^Procfile$/,
	/^Makefile$/,
	/^\.env\.example$/,
	/^README(\..+)?$/i,
	/^LICENSE(\..+)?$/i,
	/^CHANGELOG(\..+)?$/i,
	/^CONTRIBUTING(\..+)?$/i,
	/^SECURITY(\..+)?$/i,
	/^CODE_OF_CONDUCT(\..+)?$/i,
	/^CODEOWNERS$/,
	/^\.github$/,
	/^\.husky$/,
	/^\.storybook$/,
	/^\.circleci$/,
	/^\.devcontainer$/
];

async function exists(p: string): Promise<boolean> {
	try {
		await stat(p);
		return true;
	} catch {
		return false;
	}
}

export async function readPackageJson(root: string): Promise<PackageJson | null> {
	try {
		const text = await readFile(path.join(root, 'package.json'), 'utf8');
		const json = JSON.parse(text);
		return json && typeof json === 'object' ? json : null;
	} catch {
		return null;
	}
}

export async function loadProjectInfo(
	root: string,
	pkg: PackageJson | null,
	tsconfig: TsConfigSummary
): Promise<ProjectInfo> {
	const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
	const names = entries.map((e) => e.name);

	const configFiles = names.filter((n) => CONFIG_FILE_PATTERNS.some((re) => re.test(n))).sort();
	if (await exists(path.join(root, '.github', 'workflows'))) configFiles.push('.github/workflows (GitHub Actions)');
	if (await exists(path.join(root, '.github', 'dependabot.yml'))) configFiles.push('.github/dependabot.yml');

	const packageManager: ProjectInfo['packageManager'] = names.includes('pnpm-lock.yaml')
		? 'pnpm'
		: names.includes('yarn.lock')
			? 'yarn'
			: names.includes('bun.lockb') || names.includes('bun.lock')
				? 'bun'
				: names.includes('deno.json') || names.includes('deno.jsonc') || names.includes('deno.lock')
					? 'deno'
					: names.includes('package-lock.json') || names.includes('npm-shrinkwrap.json')
						? 'npm'
						: 'unknown';

	const dependencies: DeclaredDependency[] = [];
	const scopes: DependencyScope[] = [
		'dependencies',
		'devDependencies',
		'peerDependencies',
		'optionalDependencies'
	];
	if (pkg) {
		for (const scope of scopes) {
			const deps = pkg[scope];
			if (!deps || typeof deps !== 'object') continue;
			for (const [name, version] of Object.entries(deps as Record<string, unknown>)) {
				dependencies.push({ name, version: String(version), scope, importCount: 0 });
			}
		}
	}

	const frameworks: FrameworkInfo[] = [];
	const seenLabels = new Set<string>();
	const depVersions = new Map(dependencies.map((d) => [d.name, d.version]));
	for (const [pkgName, label, category] of KNOWN_FRAMEWORKS) {
		const version = depVersions.get(pkgName);
		if (version === undefined || seenLabels.has(label)) continue;
		seenLabels.add(label);
		frameworks.push({ name: label, category, version });
	}

	let pnpmWorkspacePackages = false;
	if (names.includes('pnpm-workspace.yaml')) {
		const text = await readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8').catch(() => '');
		pnpmWorkspacePackages = /^packages:/m.test(text);
	}
	const isMonorepo =
		Boolean(pkg?.workspaces) ||
		pnpmWorkspacePackages ||
		names.includes('lerna.json') ||
		names.includes('nx.json') ||
		names.includes('turbo.json');

	return {
		name: typeof pkg?.name === 'string' ? pkg.name : path.basename(root),
		version: typeof pkg?.version === 'string' ? pkg.version : null,
		description: typeof pkg?.description === 'string' ? pkg.description : null,
		license: typeof pkg?.license === 'string' ? pkg.license : null,
		nodeEngine: typeof pkg?.engines?.node === 'string' ? pkg.engines.node : null,
		packageManager,
		hasPackageJson: pkg !== null,
		isMonorepo,
		moduleType: pkg?.type === 'module' ? 'module' : pkg ? 'commonjs' : null,
		frameworks,
		dependencies,
		scripts:
			pkg?.scripts && typeof pkg.scripts === 'object'
				? Object.fromEntries(
						Object.entries(pkg.scripts as Record<string, unknown>).map(([k, v]) => [k, String(v)])
					)
				: {},
		configFiles,
		tsconfig: tsconfig.found
			? {
					strict: tsconfig.strict,
					target: tsconfig.target,
					module: tsconfig.module,
					hasPaths: tsconfig.aliases.length > 0
				}
			: null
	};
}
