import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import ignore from 'ignore';
import type { Language } from '#lib/types.js';
import { run } from './exec';

export const CODE_EXTENSIONS: Record<string, Language> = {
	'.js': 'js',
	'.mjs': 'js',
	'.cjs': 'js',
	'.jsx': 'jsx',
	'.ts': 'ts',
	'.mts': 'ts',
	'.cts': 'ts',
	'.tsx': 'tsx'
};

export const COMPONENT_EXTENSIONS: Record<string, Language> = {
	'.svelte': 'svelte',
	'.vue': 'vue'
};

/** Directories that are never worth analysing, even if they are committed. */
export const IGNORED_DIRS = new Set([
	'node_modules',
	'.git',
	'dist',
	'build',
	'out',
	'coverage',
	'.svelte-kit',
	'.next',
	'.nuxt',
	'.output',
	'.turbo',
	'.cache',
	'.parcel-cache',
	'.vercel',
	'.netlify',
	'.wrangler',
	'.yarn',
	'.pnpm-store',
	'bower_components',
	'vendor',
	'__pycache__',
	'.venv',
	'venv',
	'.idea',
	'.DS_Store'
]);

/** Hidden directories that commonly contain source we do want. */
const ALLOWED_HIDDEN_DIRS = new Set(['.storybook', '.github', '.vscode', '.changeset', '.husky']);

export interface ScannedFile {
	abs: string;
	rel: string;
	name: string;
	ext: string;
	language: Language;
	bytes: number;
}

export interface ScanResult {
	files: ScannedFile[];
	method: 'git' | 'walk';
	truncated: boolean;
	warnings: string[];
}

export function languageOf(fileName: string): Language | null {
	const ext = path.extname(fileName).toLowerCase();
	return CODE_EXTENSIONS[ext] ?? COMPONENT_EXTENSIONS[ext] ?? null;
}

export function isComponentLanguage(language: Language): boolean {
	return language === 'svelte' || language === 'vue';
}

function hasIgnoredSegment(rel: string): boolean {
	for (const segment of rel.split('/')) {
		if (IGNORED_DIRS.has(segment)) return true;
	}
	return false;
}

export async function scanProject(
	root: string,
	options: {
		includeComponents: boolean;
		maxFiles: number;
		/** Called after each batch of candidate files has been stat-ed: (files done, files total). */
		onProgress?: (done: number, total: number) => void;
	}
): Promise<ScanResult> {
	const warnings: string[] = [];
	const accept = (rel: string): Language | null => {
		if (hasIgnoredSegment(rel)) return null;
		const language = languageOf(rel);
		if (!language) return null;
		if (!options.includeComponents && isComponentLanguage(language)) return null;
		return language;
	};

	let rels: string[] | null = null;
	let method: 'git' | 'walk' = 'walk';
	let truncated = false;

	try {
		const { stdout } = await run(
			'git',
			['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
			root
		);
		rels = stdout.split('\0').filter(Boolean);
		method = 'git';
	} catch {
		// Not a git repository (or git is unavailable): fall back to walking the tree.
	}

	const candidates: { rel: string; language: Language }[] = [];
	if (rels) {
		const seen = new Set<string>();
		for (const rel of rels) {
			if (seen.has(rel)) continue;
			seen.add(rel);
			const language = accept(rel);
			if (language) candidates.push({ rel, language });
		}
	} else {
		const walked = await walk(root, accept, options.maxFiles);
		candidates.push(...walked.files);
		truncated = walked.truncated;
	}

	if (candidates.length > options.maxFiles) {
		candidates.length = options.maxFiles;
		truncated = true;
	}
	if (truncated) {
		warnings.push(
			`The project has more than ${options.maxFiles.toLocaleString()} matching files; only the first ${options.maxFiles.toLocaleString()} were analysed.`
		);
	}

	const files: ScannedFile[] = [];
	const batchSize = 64;
	for (let i = 0; i < candidates.length; i += batchSize) {
		const batch = candidates.slice(i, i + batchSize);
		const results = await Promise.all(
			batch.map(async ({ rel, language }) => {
				const abs = path.join(root, rel);
				try {
					const info = await stat(abs);
					if (!info.isFile()) return null;
					return {
						abs,
						rel,
						name: path.posix.basename(rel),
						ext: path.posix.extname(rel).toLowerCase(),
						language,
						bytes: info.size
					} satisfies ScannedFile;
				} catch {
					return null;
				}
			})
		);
		for (const r of results) if (r) files.push(r);
		options.onProgress?.(Math.min(i + batchSize, candidates.length), candidates.length);
	}

	files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
	return { files, method, truncated, warnings };
}

async function loadGitignore(root: string) {
	try {
		const text = await readFile(path.join(root, '.gitignore'), 'utf8');
		return ignore().add(text);
	} catch {
		return null;
	}
}

async function walk(
	root: string,
	accept: (rel: string) => Language | null,
	maxFiles: number
): Promise<{ files: { rel: string; language: Language }[]; truncated: boolean }> {
	const ig = await loadGitignore(root);
	const files: { rel: string; language: Language }[] = [];
	const queue: string[] = [''];
	let truncated = false;

	while (queue.length && !truncated) {
		const relDir = queue.shift()!;
		let entries: import('node:fs').Dirent[];
		try {
			entries = await readdir(path.join(root, relDir), { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
			if (entry.isSymbolicLink()) continue;
			if (entry.isDirectory()) {
				if (IGNORED_DIRS.has(entry.name)) continue;
				if (entry.name.startsWith('.') && !ALLOWED_HIDDEN_DIRS.has(entry.name)) continue;
				if (ig?.ignores(`${rel}/`)) continue;
				queue.push(rel);
			} else if (entry.isFile()) {
				if (ig?.ignores(rel)) continue;
				const language = accept(rel);
				if (!language) continue;
				files.push({ rel, language });
				if (files.length >= maxFiles) {
					truncated = true;
					break;
				}
			}
		}
	}
	return { files, truncated };
}
