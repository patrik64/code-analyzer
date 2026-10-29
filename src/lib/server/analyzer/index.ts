import { readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
	AnalysisResult,
	DirectoryStat,
	ExternalPackage,
	FileInfo,
	Language,
	Summary,
	TreeNode
} from '#lib/types.js';
import { scanProject, isComponentLanguage, type ScannedFile } from './scan';
import { analyzeSource, splitLines } from './metrics';
import { ImportResolver, conventionalAliases, isVirtualModule, loadTsConfig } from './resolve';
import { loadProjectInfo, readPackageJson } from './project';
import { buildGraph } from './graph';
import { collectGitStats } from './git';
import { createProgressReporter, type ProgressListener } from './progress';

export interface AnalyzeOptions {
	includeComponents?: boolean;
	maxFiles?: number;
	maxCommits?: number;
	/** Receives a notification whenever the pipeline enters a phase or advances within one. */
	onProgress?: ProgressListener;
}

const TEST_PATH_RE = /(^|\/)(__tests__|__mocks__|tests?|specs?|e2e|cypress|playwright)\//i;
const TEST_FILE_RE = /\.(test|spec|e2e|cy|stories)\.[cm]?[jt]sx?$/i;
const MAX_PARSE_BYTES = 3 * 1024 * 1024;

export class AnalysisError extends Error {
	constructor(
		message: string,
		public readonly status = 400
	) {
		super(message);
	}
}

/** Expand `~` and make the path absolute. */
export function resolveProjectPath(input: string): string {
	let p = input.trim();
	if (!p) throw new AnalysisError('Please provide a project folder path.');
	if (p === '~' || p.startsWith('~/')) p = path.join(os.homedir(), p.slice(1));
	return path.resolve(p);
}

export async function assertDirectory(abs: string): Promise<void> {
	try {
		const info = await stat(abs);
		if (!info.isDirectory()) throw new AnalysisError(`${abs} is not a directory.`);
	} catch (err) {
		if (err instanceof AnalysisError) throw err;
		throw new AnalysisError(`Folder not found: ${abs}`, 404);
	}
}

function isTestFile(rel: string): boolean {
	return TEST_PATH_RE.test(rel) || TEST_FILE_RE.test(rel);
}

function looksMinified(text: string, lines: string[]): boolean {
	if (text.length < 50_000) return false;
	const avg = text.length / Math.max(1, lines.length);
	if (avg > 400) return true;
	let longest = 0;
	for (const l of lines) if (l.length > longest) longest = l.length;
	return longest > 10_000 && lines.length < 200;
}

function emptyFile(scanned: ScannedFile): FileInfo {
	const dir = path.posix.dirname(scanned.rel);
	return {
		path: scanned.rel,
		dir: dir === '.' ? '' : dir,
		name: scanned.name,
		ext: scanned.ext,
		language: scanned.language,
		bytes: scanned.bytes,
		loc: 0,
		sloc: 0,
		commentLines: 0,
		blankLines: 0,
		functions: [],
		functionCount: 0,
		classes: [],
		classCount: 0,
		imports: [],
		importCount: 0,
		exportCount: 0,
		hasDefaultExport: false,
		complexity: 0,
		maxComplexity: 0,
		maxDepth: 0,
		typeDefs: 0,
		jsxElements: 0,
		anyCount: 0,
		tsDirectives: 0,
		consoleCalls: 0,
		todos: 0,
		syntaxErrors: 0,
		isTest: isTestFile(scanned.rel),
		isDeclaration: /\.d\.[cm]?ts$/i.test(scanned.rel),
		skipped: null,
		parseMs: 0,
		importedBy: 0,
		dependsOn: 0,
		git: null
	};
}

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

export async function analyzeProject(
	inputPath: string,
	options: AnalyzeOptions = {}
): Promise<AnalysisResult> {
	const started = performance.now();
	const timings: Record<string, number> = {};
	const warnings: string[] = [];
	const root = resolveProjectPath(inputPath);
	await assertDirectory(root);

	const includeComponents = options.includeComponents ?? true;
	const maxFiles = options.maxFiles ?? 15_000;
	const maxCommits = options.maxCommits ?? 25_000;

	const progress = createProgressReporter(options.onProgress);

	// ---- scan -------------------------------------------------------------------------------
	progress.phase('scan');
	let t = performance.now();
	const scan = await scanProject(root, {
		includeComponents,
		maxFiles,
		onProgress: (done, total) => progress.count('scan', done, total)
	});
	warnings.push(...scan.warnings);
	timings.scan = performance.now() - t;
	progress.plan({ files: scan.files.length });

	const fileSet = new Set(scan.files.map((f) => f.rel));

	// Git runs as a child process, so start it now and await it after parsing. Its progress is only
	// forwarded once the pipeline is actually waiting for it, so the overall bar never moves backwards.
	const gitState = { done: 0, total: 0, planned: false, waiting: false };
	const gitPromise = collectGitStats(root, fileSet, {
		maxCommits,
		onProgress: (done, total) => {
			if (!gitState.planned) {
				gitState.planned = true;
				progress.plan({ commits: total });
			}
			gitState.done = done;
			gitState.total = total;
			if (gitState.waiting) progress.count('git', done, total);
		}
	}).catch((err: Error) => ({
		stats: null,
		fileGit: new Map(),
		error: err.message
	}));

	// ---- project metadata -------------------------------------------------------------------
	progress.phase('project');
	t = performance.now();
	const [pkg, tsconfig] = await Promise.all([readPackageJson(root), loadTsConfig(root)]);
	const project = await loadProjectInfo(root, pkg, tsconfig);
	const aliases = [...tsconfig.aliases, ...(await conventionalAliases(root, pkg, tsconfig.aliases))];
	const resolver = new ImportResolver(fileSet, aliases, tsconfig.baseUrl);
	timings.project = performance.now() - t;

	// ---- parse ------------------------------------------------------------------------------
	const totalFiles = scan.files.length;
	progress.phase('parse', 0, totalFiles);
	t = performance.now();
	const files: FileInfo[] = [];
	let skippedCount = 0;
	for (let i = 0; i < totalFiles; i++) {
		const scanned = scan.files[i];
		// `i` files are finished here; the skip paths below `continue` past the end of the body.
		progress.count('parse', i, totalFiles);
		if (i > 0 && i % 25 === 0) await yieldToEventLoop();
		const info = emptyFile(scanned);
		files.push(info);
		let text: string;
		try {
			text = await readFile(scanned.abs, 'utf8');
		} catch {
			info.skipped = 'parse-error';
			skippedCount++;
			continue;
		}
		const lines = splitLines(text);
		info.loc = lines.length;
		info.blankLines = lines.filter((l) => l.trim() === '').length;
		info.sloc = info.loc - info.blankLines;

		if (scanned.bytes > MAX_PARSE_BYTES) {
			info.skipped = 'too-large';
			skippedCount++;
			continue;
		}
		if (looksMinified(text, lines)) {
			info.skipped = 'minified';
			skippedCount++;
			continue;
		}

		const parseStart = performance.now();
		try {
			const m = analyzeSource(text, scanned.language);
			info.loc = m.loc;
			info.sloc = m.sloc;
			info.commentLines = m.commentLines;
			info.blankLines = m.blankLines;
			info.functions = m.functions;
			info.functionCount = m.functions.length;
			info.classes = m.classes;
			info.classCount = m.classes.length;
			info.imports = m.imports;
			info.importCount = m.imports.length;
			info.exportCount = m.exportCount;
			info.hasDefaultExport = m.hasDefaultExport;
			info.complexity = m.complexity;
			info.maxComplexity = m.maxComplexity;
			info.maxDepth = m.maxDepth;
			info.typeDefs = m.typeDefs;
			info.jsxElements = m.jsxElements;
			info.anyCount = m.anyCount;
			info.tsDirectives = m.tsDirectives;
			info.consoleCalls = m.consoleCalls;
			info.todos = m.todos;
			info.syntaxErrors = m.syntaxErrors;
		} catch (err) {
			info.skipped = 'parse-error';
			skippedCount++;
			warnings.push(`Failed to parse ${scanned.rel}: ${(err as Error).message}`);
		}
		info.parseMs = performance.now() - parseStart;

		for (const imp of info.imports) {
			const r = resolver.resolve(info.path, imp.source);
			imp.target = r.target;
			imp.resolved = r.resolved;
			imp.packageName = r.packageName;
		}
	}
	progress.count('parse', totalFiles, totalFiles);
	timings.parse = performance.now() - t;
	if (skippedCount) {
		warnings.push(
			`${skippedCount} file${skippedCount === 1 ? ' was' : 's were'} counted but not parsed (minified, too large, or unreadable).`
		);
	}

	// ---- graph ------------------------------------------------------------------------------
	progress.phase('graph');
	t = performance.now();
	const graph = buildGraph(files);
	timings.graph = performance.now() - t;

	// ---- externals --------------------------------------------------------------------------
	progress.phase('externals');
	t = performance.now();
	const externals = aggregateExternals(files, project.dependencies, project.hasPackageJson ? project.name : null);
	timings.externals = performance.now() - t;

	// ---- git --------------------------------------------------------------------------------
	gitState.waiting = true;
	progress.phase('git', gitState.done, gitState.total);
	t = performance.now();
	const git = await gitPromise;
	for (const file of files) file.git = git.fileGit.get(file.path) ?? null;
	if (git.stats?.truncated) {
		warnings.push(
			`Git history is long: only the most recent ${git.stats.analyzedCommits.toLocaleString()} of ${git.stats.totalCommits.toLocaleString()} commits were analysed.`
		);
	}
	timings.git = performance.now() - t;

	// ---- aggregates -------------------------------------------------------------------------
	progress.phase('aggregate');
	t = performance.now();
	const directories = aggregateDirectories(files);
	const tree = buildTree(files, project.name);
	const summary = summarize(files, graph.cycles.length);
	timings.aggregate = performance.now() - t;

	progress.phase('done');
	const durationMs = performance.now() - started;
	return {
		path: root,
		name: project.name,
		analyzedAt: new Date().toISOString(),
		durationMs,
		timings,
		scanMethod: scan.method,
		summary,
		files,
		directories,
		tree,
		graph,
		externals,
		git: git.stats,
		gitError: git.error,
		project,
		warnings
	};
}

function aggregateExternals(
	files: FileInfo[],
	declared: AnalysisResult['project']['dependencies'],
	selfName: string | null
): ExternalPackage[] {
	const declaredMap = new Map(declared.map((d) => [d.name, d]));
	const map = new Map<string, { count: number; files: Set<string>; typeOnly: boolean; builtin: boolean }>();
	for (const file of files) {
		for (const imp of file.imports) {
			if ((imp.target !== 'external' && imp.target !== 'builtin') || !imp.packageName) continue;
			let entry = map.get(imp.packageName);
			if (!entry) {
				entry = { count: 0, files: new Set(), typeOnly: true, builtin: imp.target === 'builtin' };
				map.set(imp.packageName, entry);
			}
			entry.count++;
			entry.files.add(file.path);
			entry.typeOnly &&= imp.typeOnly;
		}
	}
	const result: ExternalPackage[] = [];
	for (const [name, entry] of map) {
		const dep = declaredMap.get(name) ?? (name.startsWith('@types/') ? undefined : declaredMap.get(`@types/${name}`));
		const direct = declaredMap.get(name);
		if (direct) direct.importCount = entry.count;
		result.push({
			name,
			importCount: entry.count,
			files: [...entry.files].sort(),
			declared: direct?.scope ?? (dep ? dep.scope : null),
			declaredVersion: direct?.version ?? null,
			builtin: entry.builtin,
			virtual: isVirtualModule(name),
			self: selfName !== null && name === selfName,
			typeOnly: entry.typeOnly
		});
	}
	return result.sort((a, b) => b.importCount - a.importCount || a.name.localeCompare(b.name));
}

function aggregateDirectories(files: FileInfo[]): DirectoryStat[] {
	const map = new Map<string, DirectoryStat>();
	const bump = (dir: string, f: FileInfo) => {
		let d = map.get(dir);
		if (!d) {
			d = { path: dir, files: 0, loc: 0, sloc: 0, functions: 0, complexity: 0, commentLines: 0 };
			map.set(dir, d);
		}
		d.files++;
		d.loc += f.loc;
		d.sloc += f.sloc;
		d.functions += f.functionCount;
		d.complexity += f.complexity;
		d.commentLines += f.commentLines;
	};
	for (const f of files) {
		if (f.dir === '') {
			bump('', f);
			continue;
		}
		const parts = f.dir.split('/');
		for (let i = 1; i <= parts.length; i++) bump(parts.slice(0, i).join('/'), f);
	}
	return [...map.values()].sort((a, b) => b.loc - a.loc);
}

function buildTree(files: FileInfo[], rootName: string): TreeNode {
	const root: TreeNode = { name: rootName, path: '', loc: 0, children: [] };
	const dirs = new Map<string, TreeNode>([['', root]]);
	const ensureDir = (dir: string): TreeNode => {
		const existing = dirs.get(dir);
		if (existing) return existing;
		const parentPath = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '';
		const parent = ensureDir(parentPath);
		const node: TreeNode = { name: dir.slice(dir.lastIndexOf('/') + 1), path: dir, loc: 0, children: [] };
		parent.children!.push(node);
		dirs.set(dir, node);
		return node;
	};
	for (const f of files) {
		const parent = ensureDir(f.dir);
		parent.children!.push({ name: f.name, path: f.path, loc: f.loc, language: f.language });
	}
	const total = (node: TreeNode): number => {
		if (!node.children) return node.loc;
		node.loc = node.children.reduce((sum, c) => sum + total(c), 0);
		return node.loc;
	};
	total(root);
	return root;
}

function median(values: number[]): number {
	if (!values.length) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function summarize(files: FileInfo[], cycles: number): Summary {
	const languages: Language[] = ['ts', 'tsx', 'js', 'jsx', 'svelte', 'vue'];
	const byLanguage = Object.fromEntries(
		languages.map((l) => [l, { files: 0, loc: 0 }])
	) as Summary['byLanguage'];

	const s: Summary = {
		files: 0,
		jsFiles: 0,
		tsFiles: 0,
		componentFiles: 0,
		testFiles: 0,
		declarationFiles: 0,
		skippedFiles: 0,
		bytes: 0,
		loc: 0,
		sloc: 0,
		commentLines: 0,
		blankLines: 0,
		testLoc: 0,
		functions: 0,
		classes: 0,
		imports: 0,
		exports: 0,
		typeDefs: 0,
		totalComplexity: 0,
		avgComplexityPerFunction: 0,
		avgFunctionLength: 0,
		medianFileLoc: 0,
		avgFileLoc: 0,
		longFunctions: 0,
		complexFunctions: 0,
		manyParamFunctions: 0,
		asyncFunctions: 0,
		anyCount: 0,
		tsDirectives: 0,
		consoleCalls: 0,
		todos: 0,
		filesWithSyntaxErrors: 0,
		byLanguage,
		commentRatio: 0,
		internalImports: 0,
		externalImports: 0,
		unresolvedImports: 0,
		cycles
	};

	let functionLines = 0;
	let functionComplexity = 0;
	for (const f of files) {
		s.files++;
		if (f.language === 'js' || f.language === 'jsx') s.jsFiles++;
		else if (f.language === 'ts' || f.language === 'tsx') s.tsFiles++;
		else s.componentFiles++;
		if (f.isTest) {
			s.testFiles++;
			s.testLoc += f.loc;
		}
		if (f.isDeclaration) s.declarationFiles++;
		if (f.skipped) s.skippedFiles++;
		s.bytes += f.bytes;
		s.loc += f.loc;
		s.sloc += f.sloc;
		s.commentLines += f.commentLines;
		s.blankLines += f.blankLines;
		s.functions += f.functionCount;
		s.classes += f.classCount;
		s.imports += f.importCount;
		s.exports += f.exportCount;
		s.typeDefs += f.typeDefs;
		s.totalComplexity += f.complexity;
		s.anyCount += f.anyCount;
		s.tsDirectives += f.tsDirectives;
		s.consoleCalls += f.consoleCalls;
		s.todos += f.todos;
		if (f.syntaxErrors > 0) s.filesWithSyntaxErrors++;
		byLanguage[f.language].files++;
		byLanguage[f.language].loc += f.loc;
		for (const fn of f.functions) {
			functionLines += fn.lines;
			functionComplexity += fn.complexity;
			if (fn.lines > 50) s.longFunctions++;
			if (fn.complexity > 10) s.complexFunctions++;
			if (fn.params > 4) s.manyParamFunctions++;
			if (fn.async) s.asyncFunctions++;
		}
		for (const imp of f.imports) {
			if (imp.target === 'internal') s.internalImports++;
			else if (imp.target === 'external' || imp.target === 'builtin') s.externalImports++;
			else if (imp.target === 'unresolved') s.unresolvedImports++;
		}
	}
	s.avgComplexityPerFunction = s.functions ? functionComplexity / s.functions : 0;
	s.avgFunctionLength = s.functions ? functionLines / s.functions : 0;
	s.medianFileLoc = median(files.map((f) => f.loc));
	s.avgFileLoc = s.files ? s.loc / s.files : 0;
	s.commentRatio = s.sloc + s.commentLines ? s.commentLines / (s.sloc + s.commentLines) : 0;
	return s;
}
