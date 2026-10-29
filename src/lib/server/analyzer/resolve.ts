import path from 'node:path';
import { builtinModules } from 'node:module';
import { readFile, stat } from 'node:fs/promises';
import { parse as parseJsonc } from 'jsonc-parser';
import type { ImportTarget } from '#lib/types.js';

const BUILTINS = new Set<string>([
	...builtinModules,
	...builtinModules.map((m) => `node:${m}`),
	'node:test',
	'node:sqlite',
	'node:sea',
	'bun',
	'bun:test',
	'bun:sqlite',
	'deno'
]);

const ASSET_RE =
	/\.(css|scss|sass|less|styl|svg|png|jpe?g|gif|webp|avif|ico|bmp|json|json5|ya?ml|toml|md|mdx|html|txt|csv|wasm|woff2?|ttf|otf|eot|mp3|mp4|webm|ogg|wav|glsl|graphql|gql|sql|pdf|zip|node)$/i;

const EXTENSION_CANDIDATES = [
	'.ts',
	'.tsx',
	'.js',
	'.jsx',
	'.mjs',
	'.cjs',
	'.mts',
	'.cts',
	'.d.ts',
	'.svelte',
	'.vue',
	'.json'
];
const INDEX_CANDIDATES = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.d.ts'];

/** Virtual modules provided by frameworks/bundlers rather than real packages. */
const VIRTUAL_PREFIXES = [
	'$app/',
	'$env/',
	'$service-worker',
	'virtual:',
	'astro:',
	'#app',
	'#imports',
	'#build',
	'nuxt/',
	'~icons/',
	'unplugin-',
	'vite/',
	'$types'
];

export function isVirtualModule(spec: string): boolean {
	return VIRTUAL_PREFIXES.some((p) => spec === p.replace(/\/$/, '') || spec.startsWith(p));
}

export interface AliasRule {
	/** e.g. `@/*`, `$lib`, `$lib/*`, `#lib/*` */
	pattern: string;
	/** project-relative targets, may contain `*` */
	targets: string[];
}

export interface TsConfigSummary {
	found: boolean;
	strict: boolean | null;
	target: string | null;
	module: string | null;
	baseUrl: string | null;
	aliases: AliasRule[];
}

export interface Resolution {
	target: ImportTarget;
	resolved: string | null;
	packageName: string | null;
}

export class ImportResolver {
	constructor(
		private readonly files: Set<string>,
		private readonly aliases: AliasRule[],
		private readonly baseUrl: string | null
	) {}

	resolve(fromFile: string, rawSpec: string): Resolution {
		// Strip bundler suffixes such as `?raw`, `?url`.
		const spec = rawSpec.replace(/\?.*$/, '');
		if (!spec) return { target: 'unresolved', resolved: null, packageName: null };

		if (BUILTINS.has(spec)) {
			return { target: 'builtin', resolved: null, packageName: spec.replace(/^node:/, '') };
		}

		// Generated SvelteKit route types (./$types) are not real files.
		if (/(^|\/)\$types(\.d\.ts|\.js|\.ts)?$/.test(spec)) {
			return { target: 'external', resolved: null, packageName: '$types' };
		}

		if (spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..') {
			const candidate = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
			return this.internalOrAsset(candidate, spec);
		}

		if (spec.startsWith('/')) {
			return this.internalOrAsset(spec.slice(1), spec);
		}

		let aliasMatched = false;
		for (const rule of this.aliases) {
			const captured = matchPattern(rule.pattern, spec);
			if (captured === null) continue;
			aliasMatched = true;
			for (const target of rule.targets) {
				const candidate = path.posix.normalize(target.replace('*', captured));
				const hit = this.probe(candidate);
				if (hit) return { target: 'internal', resolved: hit, packageName: null };
			}
		}
		if (aliasMatched) {
			return ASSET_RE.test(spec)
				? { target: 'asset', resolved: null, packageName: null }
				: { target: 'unresolved', resolved: null, packageName: null };
		}

		if (isVirtualModule(spec)) {
			return { target: 'external', resolved: null, packageName: virtualPackageName(spec) };
		}

		if (this.baseUrl !== null) {
			const candidate = path.posix.normalize(path.posix.join(this.baseUrl, spec));
			const hit = this.probe(candidate);
			if (hit) return { target: 'internal', resolved: hit, packageName: null };
		}

		if (spec.startsWith('#')) {
			// package.json "imports" entry that we could not map
			return { target: 'unresolved', resolved: null, packageName: null };
		}

		return { target: 'external', resolved: null, packageName: packageNameOf(spec) };
	}

	private internalOrAsset(candidate: string, spec: string): Resolution {
		const hit = this.probe(candidate);
		if (hit) return { target: 'internal', resolved: hit, packageName: null };
		if (ASSET_RE.test(spec)) return { target: 'asset', resolved: null, packageName: null };
		return { target: 'unresolved', resolved: null, packageName: null };
	}

	private probe(candidate: string): string | null {
		const files = this.files;
		if (files.has(candidate)) return candidate;
		for (const ext of EXTENSION_CANDIDATES) {
			if (files.has(candidate + ext)) return candidate + ext;
		}
		// ESM-style TypeScript: `./foo.js` refers to `./foo.ts`
		const jsExt = /\.(m|c)?jsx?$/.exec(candidate);
		if (jsExt) {
			const base = candidate.slice(0, -jsExt[0].length);
			for (const ext of ['.ts', '.tsx', '.mts', '.cts', '.d.ts']) {
				if (files.has(base + ext)) return base + ext;
			}
		}
		for (const ext of INDEX_CANDIDATES) {
			const indexPath = `${candidate}/index${ext}`;
			if (files.has(indexPath)) return indexPath;
		}
		return null;
	}
}

function matchPattern(pattern: string, spec: string): string | null {
	const star = pattern.indexOf('*');
	if (star === -1) return pattern === spec ? '' : null;
	const prefix = pattern.slice(0, star);
	const suffix = pattern.slice(star + 1);
	if (spec.length >= prefix.length + suffix.length && spec.startsWith(prefix) && spec.endsWith(suffix)) {
		return spec.slice(prefix.length, spec.length - suffix.length);
	}
	return null;
}

export function packageNameOf(spec: string): string {
	const parts = spec.split('/');
	if (spec.startsWith('@') && parts.length >= 2) return `${parts[0]}/${parts[1]}`;
	return parts[0];
}

function virtualPackageName(spec: string): string {
	if (spec.startsWith('virtual:') || spec.startsWith('astro:')) return spec;
	return spec.split('/')[0];
}

async function exists(p: string): Promise<boolean> {
	try {
		await stat(p);
		return true;
	} catch {
		return false;
	}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function readJsonc(file: string): Promise<Json | null> {
	try {
		const text = await readFile(file, 'utf8');
		const errors: unknown[] = [];
		const value = parseJsonc(text, errors as never, { allowTrailingComma: true });
		return value ?? null;
	} catch {
		return null;
	}
}

interface LoadedConfig {
	compilerOptions: Record<string, Json>;
	/** directory the `paths` are relative to */
	pathsBase: string | null;
}

async function loadConfigChain(file: string, depth = 0): Promise<LoadedConfig | null> {
	if (depth > 5) return null;
	const json = await readJsonc(file);
	if (!json || typeof json !== 'object') return null;
	const dir = path.dirname(file);
	let merged: LoadedConfig = { compilerOptions: {}, pathsBase: null };

	const extendsList: string[] = Array.isArray(json.extends)
		? json.extends
		: typeof json.extends === 'string'
			? [json.extends]
			: [];
	for (const ext of extendsList) {
		if (!ext.startsWith('.') && !ext.startsWith('/')) continue; // package-based configs are skipped
		let target = path.resolve(dir, ext);
		if (!/\.json$/i.test(target) && !(await exists(target))) target += '.json';
		const parent = await loadConfigChain(target, depth + 1);
		if (parent) {
			merged = {
				compilerOptions: { ...merged.compilerOptions, ...parent.compilerOptions },
				pathsBase: parent.pathsBase ?? merged.pathsBase
			};
		}
	}

	const own = (json.compilerOptions ?? {}) as Record<string, Json>;
	if (own.paths || own.baseUrl) {
		merged.pathsBase = own.baseUrl ? path.resolve(dir, String(own.baseUrl)) : dir;
	}
	merged.compilerOptions = { ...merged.compilerOptions, ...own };
	return merged;
}

/** Read tsconfig/jsconfig (following relative `extends`) and turn `paths` into alias rules. */
export async function loadTsConfig(root: string): Promise<TsConfigSummary> {
	const summary: TsConfigSummary = {
		found: false,
		strict: null,
		target: null,
		module: null,
		baseUrl: null,
		aliases: []
	};
	let file: string | null = null;
	for (const name of ['tsconfig.json', 'jsconfig.json']) {
		if (await exists(path.join(root, name))) {
			file = path.join(root, name);
			break;
		}
	}
	if (!file) return summary;
	const loaded = await loadConfigChain(file);
	if (!loaded) return summary;
	summary.found = true;
	const co = loaded.compilerOptions;
	summary.strict = typeof co.strict === 'boolean' ? co.strict : null;
	summary.target = typeof co.target === 'string' ? co.target : null;
	summary.module = typeof co.module === 'string' ? co.module : null;

	const base = loaded.pathsBase ?? root;
	if (co.baseUrl) {
		const rel = toPosixRelative(root, path.resolve(path.dirname(file), String(co.baseUrl)));
		summary.baseUrl = rel;
	}
	if (co.paths && typeof co.paths === 'object') {
		for (const [pattern, targets] of Object.entries(co.paths as Record<string, unknown>)) {
			if (!Array.isArray(targets)) continue;
			const rels = targets
				.filter((t): t is string => typeof t === 'string')
				.map((t) => toPosixRelative(root, path.resolve(base, t)))
				.filter((t) => !t.startsWith('..'));
			if (rels.length) summary.aliases.push({ pattern, targets: rels });
		}
	}
	return summary;
}

function toPosixRelative(root: string, abs: string): string {
	const rel = path.relative(root, abs).split(path.sep).join('/');
	return rel === '' ? '.' : rel;
}

/** Alias rules from package.json `imports` (`#lib/*`), SvelteKit `$lib`, and common conventions. */
export async function conventionalAliases(
	root: string,
	packageJson: Record<string, Json> | null,
	existing: AliasRule[]
): Promise<AliasRule[]> {
	const rules: AliasRule[] = [];
	const known = new Set(existing.map((r) => r.pattern));
	const add = (pattern: string, targets: string[]) => {
		if (known.has(pattern)) return;
		known.add(pattern);
		rules.push({ pattern, targets });
	};

	const imports = packageJson?.imports;
	if (imports && typeof imports === 'object') {
		for (const [pattern, value] of Object.entries(imports as Record<string, unknown>)) {
			const target = firstStringTarget(value);
			if (target && target.startsWith('.')) add(pattern, [target.replace(/^\.\//, '')]);
		}
	}

	const hasSrcLib = await exists(path.join(root, 'src', 'lib'));
	if (hasSrcLib) {
		add('$lib', ['src/lib/index']);
		add('$lib/*', ['src/lib/*']);
		add('#lib', ['src/lib/index']);
		add('#lib/*', ['src/lib/*']);
	}
	const hasSrc = await exists(path.join(root, 'src'));
	if (hasSrc) {
		add('@/*', ['src/*']);
		add('~/*', ['src/*', '*']);
		add('src/*', ['src/*']);
		add('@components/*', ['src/components/*']);
		add('@lib/*', ['src/lib/*']);
	} else {
		add('@/*', ['*']);
		add('~/*', ['*']);
	}
	return rules;
}

function firstStringTarget(value: unknown): string | null {
	if (typeof value === 'string') return value;
	if (Array.isArray(value)) {
		for (const v of value) {
			const s = firstStringTarget(v);
			if (s) return s;
		}
		return null;
	}
	if (value && typeof value === 'object') {
		for (const v of Object.values(value as Record<string, unknown>)) {
			const s = firstStringTarget(v);
			if (s) return s;
		}
	}
	return null;
}
