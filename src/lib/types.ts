/** Shared types for the analysis result (server produces, client renders). */

export type Language = 'ts' | 'tsx' | 'js' | 'jsx' | 'svelte' | 'vue';

export type FunctionKind =
	| 'function'
	| 'arrow'
	| 'method'
	| 'constructor'
	| 'getter'
	| 'setter'
	| 'generator'
	| 'expression';

export interface FunctionInfo {
	name: string;
	kind: FunctionKind;
	line: number;
	endLine: number;
	lines: number;
	params: number;
	complexity: number;
	async: boolean;
	exported: boolean;
}

export type ImportKind = 'static' | 'dynamic' | 'require' | 'reexport';
export type ImportTarget = 'internal' | 'external' | 'builtin' | 'asset' | 'unresolved';

export interface ImportInfo {
	source: string;
	kind: ImportKind;
	typeOnly: boolean;
	names: string[];
	line: number;
	target: ImportTarget;
	/** Project-relative path of the imported file (internal targets). */
	resolved: string | null;
	/** Package name for external targets (e.g. `react`, `@scope/pkg`). */
	packageName: string | null;
}

export interface FileGitInfo {
	commits: number;
	recentCommits: number;
	authors: number;
	additions: number;
	deletions: number;
	firstCommit: string;
	lastModified: string;
	topAuthor: string;
	topAuthorShare: number;
}

export interface FileInfo {
	path: string;
	dir: string;
	name: string;
	ext: string;
	language: Language;
	bytes: number;
	loc: number;
	sloc: number;
	commentLines: number;
	blankLines: number;
	functions: FunctionInfo[];
	functionCount: number;
	classes: string[];
	classCount: number;
	imports: ImportInfo[];
	importCount: number;
	exportCount: number;
	hasDefaultExport: boolean;
	complexity: number;
	maxComplexity: number;
	maxDepth: number;
	typeDefs: number;
	jsxElements: number;
	anyCount: number;
	tsDirectives: number;
	consoleCalls: number;
	todos: number;
	syntaxErrors: number;
	isTest: boolean;
	isDeclaration: boolean;
	skipped: 'minified' | 'too-large' | 'parse-error' | null;
	parseMs: number;
	importedBy: number;
	dependsOn: number;
	git: FileGitInfo | null;
}

export interface GraphNode {
	id: string;
	label: string;
	dir: string;
	language: Language | 'external';
	loc: number;
	inDegree: number;
	outDegree: number;
	kind: 'file' | 'external';
	isTest: boolean;
}

export interface GraphEdge {
	source: string;
	target: string;
	weight: number;
	typeOnly: boolean;
	dynamic: boolean;
}

export interface GraphData {
	nodes: GraphNode[];
	edges: GraphEdge[];
	externalNodes: GraphNode[];
	externalEdges: GraphEdge[];
	cycles: string[][];
	orphans: string[];
	entryPoints: string[];
	hubs: { path: string; inDegree: number }[];
	unresolved: { from: string; source: string; line: number }[];
	fanOut: { path: string; outDegree: number }[];
}

export type DependencyScope =
	| 'dependencies'
	| 'devDependencies'
	| 'peerDependencies'
	| 'optionalDependencies';

export interface ExternalPackage {
	name: string;
	importCount: number;
	files: string[];
	declared: DependencyScope | null;
	declaredVersion: string | null;
	builtin: boolean;
	virtual: boolean;
	/** The project's own package name (self-import), e.g. docs or tests importing the published name. */
	self: boolean;
	typeOnly: boolean;
}

export interface DeclaredDependency {
	name: string;
	version: string;
	scope: DependencyScope;
	importCount: number;
}

export interface GitCommit {
	hash: string;
	shortHash: string;
	author: string;
	email: string;
	date: string;
	subject: string;
	additions: number;
	deletions: number;
	files: number;
	isMerge: boolean;
}

export interface GitAuthor {
	name: string;
	email: string;
	commits: number;
	additions: number;
	deletions: number;
	firstCommit: string;
	lastCommit: string;
	filesTouched: number;
	filesOwned: number;
	activeDays: number;
}

export interface GitTimelinePoint {
	period: string;
	commits: number;
	additions: number;
	deletions: number;
	authors: number;
}

export interface GitFileChurn {
	path: string;
	commits: number;
	recentCommits: number;
	additions: number;
	deletions: number;
	authors: number;
	lastModified: string;
	analyzed: boolean;
}

export interface GitStats {
	root: string;
	scopedToSubdir: string | null;
	branch: string;
	remote: string | null;
	totalCommits: number;
	analyzedCommits: number;
	truncated: boolean;
	firstCommit: string;
	lastCommit: string;
	authors: GitAuthor[];
	recentCommits: GitCommit[];
	timeline: GitTimelinePoint[];
	timelineUnit: 'week' | 'month';
	activity: number[][];
	fileChurn: GitFileChurn[];
	uncommittedChanges: number;
	tagCount: number;
	latestTag: string | null;
	commitsLast30d: number;
	commitsLast90d: number;
	commitsLast365d: number;
	activeAuthorsLast90d: number;
	avgFilesPerCommit: number;
	avgLinesPerCommit: number;
	filesWithHistory: number;
	singleAuthorFiles: number;
	mergeCommits: number;
}

export interface FrameworkInfo {
	name: string;
	category: 'framework' | 'meta-framework' | 'ui' | 'build' | 'test' | 'style' | 'data' | 'runtime' | 'lint';
	version: string;
}

export interface ProjectInfo {
	name: string;
	version: string | null;
	description: string | null;
	license: string | null;
	nodeEngine: string | null;
	packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun' | 'deno' | 'unknown';
	hasPackageJson: boolean;
	isMonorepo: boolean;
	moduleType: 'module' | 'commonjs' | null;
	frameworks: FrameworkInfo[];
	dependencies: DeclaredDependency[];
	scripts: Record<string, string>;
	configFiles: string[];
	tsconfig: {
		strict: boolean | null;
		target: string | null;
		module: string | null;
		hasPaths: boolean;
	} | null;
}

export interface DirectoryStat {
	path: string;
	files: number;
	loc: number;
	sloc: number;
	functions: number;
	complexity: number;
	commentLines: number;
}

export interface TreeNode {
	name: string;
	path: string;
	loc: number;
	language?: Language;
	children?: TreeNode[];
}

export interface Summary {
	files: number;
	jsFiles: number;
	tsFiles: number;
	componentFiles: number;
	testFiles: number;
	declarationFiles: number;
	skippedFiles: number;
	bytes: number;
	loc: number;
	sloc: number;
	commentLines: number;
	blankLines: number;
	testLoc: number;
	functions: number;
	classes: number;
	imports: number;
	exports: number;
	typeDefs: number;
	totalComplexity: number;
	avgComplexityPerFunction: number;
	avgFunctionLength: number;
	medianFileLoc: number;
	avgFileLoc: number;
	longFunctions: number;
	complexFunctions: number;
	manyParamFunctions: number;
	asyncFunctions: number;
	anyCount: number;
	tsDirectives: number;
	consoleCalls: number;
	todos: number;
	filesWithSyntaxErrors: number;
	byLanguage: Record<Language, { files: number; loc: number }>;
	commentRatio: number;
	internalImports: number;
	externalImports: number;
	unresolvedImports: number;
	cycles: number;
}

export interface AnalysisResult {
	path: string;
	name: string;
	analyzedAt: string;
	durationMs: number;
	timings: Record<string, number>;
	scanMethod: 'git' | 'walk';
	summary: Summary;
	files: FileInfo[];
	directories: DirectoryStat[];
	tree: TreeNode;
	graph: GraphData;
	externals: ExternalPackage[];
	git: GitStats | null;
	gitError: string | null;
	project: ProjectInfo;
	warnings: string[];
}

/** Steps of the analysis pipeline in the order they run (`git` overlaps with `parse` in the background). */
export type AnalysisPhase =
	| 'queued'
	| 'scan'
	| 'project'
	| 'parse'
	| 'graph'
	| 'externals'
	| 'git'
	| 'aggregate'
	| 'done'
	| 'error';

/** Live progress of a running analysis, as streamed by `GET /api/analyze/progress`. */
export interface AnalysisProgress {
	phase: AnalysisPhase;
	/** Short description of the current step, e.g. "Parsing files". */
	message: string;
	/** Estimated overall completion, 0–1; never decreases while an analysis runs. */
	fraction: number;
	/** Items finished in the current step (files scanned or parsed, commits read), when known. */
	done: number | null;
	total: number | null;
	/** Milliseconds since the analysis started; 0 while queued. */
	elapsedMs: number;
	/** The failure message when `phase` is `error`. */
	error: string | null;
}
