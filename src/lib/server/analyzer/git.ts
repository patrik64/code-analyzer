import path from 'node:path';
import { realpath } from 'node:fs/promises';
import type {
	FileGitInfo,
	GitAuthor,
	GitCommit,
	GitFileChurn,
	GitStats,
	GitTimelinePoint
} from '#lib/types.js';
import { run } from './exec';

export interface GitCollection {
	stats: GitStats | null;
	fileGit: Map<string, FileGitInfo>;
	error: string | null;
}

interface ParsedCommit {
	hash: string;
	author: string;
	email: string;
	date: string;
	isMerge: boolean;
	subject: string;
	files: { path: string; additions: number; deletions: number }[];
}

const DAY = 24 * 60 * 60 * 1000;

async function tryRun(args: string[], cwd: string): Promise<string | null> {
	try {
		const { stdout } = await run('git', args, cwd);
		return stdout.trim();
	} catch {
		return null;
	}
}

/** Normalise rename notation from `--numstat`: `src/{old => new}/x.ts`, `old.ts => new.ts`. */
export function normalizeGitPath(p: string): string {
	let out = p.replace(/\{([^{}]*) => ([^{}]*)\}/g, (_m, _from, to) => to);
	if (out.includes(' => ')) out = out.split(' => ').pop() ?? out;
	return out.replace(/\/{2,}/g, '/').replace(/^\.\//, '');
}

function parseLog(raw: string): ParsedCommit[] {
	const commits: ParsedCommit[] = [];
	for (const record of raw.split('\u001e')) {
		if (!record.trim()) continue;
		const lines = record.split('\n');
		const header = lines[0].split('\u001f');
		if (header.length < 6) continue;
		const [hash, author, email, date, parents, ...subjectParts] = header;
		const commit: ParsedCommit = {
			hash,
			author,
			email,
			date,
			isMerge: parents.trim().split(' ').filter(Boolean).length > 1,
			subject: subjectParts.join('\u001f'),
			files: []
		};
		for (let i = 1; i < lines.length; i++) {
			const line = lines[i];
			if (!line) continue;
			const tab1 = line.indexOf('\t');
			const tab2 = line.indexOf('\t', tab1 + 1);
			if (tab1 === -1 || tab2 === -1) continue;
			const add = line.slice(0, tab1);
			const del = line.slice(tab1 + 1, tab2);
			const filePath = normalizeGitPath(line.slice(tab2 + 1));
			commit.files.push({
				path: filePath,
				additions: add === '-' ? 0 : Number(add) || 0,
				deletions: del === '-' ? 0 : Number(del) || 0
			});
		}
		commits.push(commit);
	}
	return commits;
}

/** Local calendar parts from a strict-ISO date with offset (keeps the author's own timezone). */
function localParts(iso: string): { y: number; m: number; d: number; hour: number; weekday: number } {
	const y = Number(iso.slice(0, 4));
	const m = Number(iso.slice(5, 7));
	const d = Number(iso.slice(8, 10));
	const hour = Number(iso.slice(11, 13));
	const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
	return { y, m, d, hour: Number.isFinite(hour) ? hour : 0, weekday };
}

function pad(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

function weekStartKey(y: number, m: number, d: number): string {
	const date = new Date(Date.UTC(y, m - 1, d));
	const offset = (date.getUTCDay() + 6) % 7; // Monday = 0
	date.setUTCDate(date.getUTCDate() - offset);
	return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function monthKey(y: number, m: number): string {
	return `${y}-${pad(m)}`;
}

function nextPeriod(key: string, unit: 'week' | 'month'): string {
	if (unit === 'month') {
		const [y, m] = key.split('-').map(Number);
		return m === 12 ? monthKey(y + 1, 1) : monthKey(y, m + 1);
	}
	const [y, m, d] = key.split('-').map(Number);
	const date = new Date(Date.UTC(y, m - 1, d + 7));
	return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export async function collectGitStats(
	root: string,
	analyzedFiles: Set<string>,
	options: {
		maxCommits: number;
		/** Called as the `git log` output streams in: (commits read so far, commits expected). */
		onProgress?: (done: number, total: number) => void;
	}
): Promise<GitCollection> {
	const empty: GitCollection = { stats: null, fileGit: new Map(), error: null };

	const topLevel = await tryRun(['rev-parse', '--show-toplevel'], root);
	if (!topLevel) {
		options.onProgress?.(0, 0);
		return { ...empty, error: 'Not a git repository' };
	}

	let prefix = '';
	try {
		const [realRoot, realTop] = await Promise.all([realpath(root), realpath(topLevel)]);
		prefix = path.relative(realTop, realRoot).split(path.sep).join('/');
	} catch {
		prefix = '';
	}
	if (prefix.startsWith('..')) prefix = '';
	const toProjectPath = (gitPath: string): string | null => {
		if (!prefix) return gitPath;
		if (gitPath.startsWith(prefix + '/')) return gitPath.slice(prefix.length + 1);
		return null;
	};

	const totalCommitsRaw = await tryRun(['rev-list', '--count', 'HEAD', '--', '.'], root);
	if (totalCommitsRaw === null) {
		options.onProgress?.(0, 0);
		return { ...empty, error: 'Repository has no commits yet' };
	}
	const totalCommits = Number(totalCommitsRaw) || 0;

	// Count commit records as `git log` streams them so callers can show progress: every record in
	// the format below starts with a record separator (\x1e).
	const expectedCommits = Math.min(totalCommits, options.maxCommits);
	const onProgress = options.onProgress;
	let commitsRead = 0;
	onProgress?.(0, expectedCommits);
	const onStdout =
		onProgress && expectedCommits > 0
			? (chunk: string) => {
					let i = chunk.indexOf('\u001e');
					if (i === -1) return;
					while (i !== -1) {
						commitsRead++;
						i = chunk.indexOf('\u001e', i + 1);
					}
					onProgress(Math.min(commitsRead, expectedCommits), expectedCommits);
				}
			: undefined;

	const [branch, remote, tagList, latestTag, status, logRaw] = await Promise.all([
		tryRun(['rev-parse', '--abbrev-ref', 'HEAD'], root),
		tryRun(['remote', 'get-url', 'origin'], root),
		tryRun(['tag', '--list'], root),
		tryRun(['describe', '--tags', '--abbrev=0'], root),
		tryRun(['status', '--porcelain', '--', '.'], root),
		run(
			'git',
			[
				'log',
				'--numstat',
				'--no-color',
				'--date=iso-strict',
				'--format=%x1e%H%x1f%aN%x1f%aE%x1f%aI%x1f%P%x1f%s',
				`-n`,
				String(options.maxCommits),
				'--',
				'.'
			],
			root,
			{ onStdout }
		).then((r) => r.stdout)
	]);

	const commits = parseLog(logRaw);
	if (commits.length === 0) return { ...empty, error: 'No commits found for this folder' };

	const now = Date.now();
	const since30 = now - 30 * DAY;
	const since90 = now - 90 * DAY;
	const since365 = now - 365 * DAY;

	// ---- per author -------------------------------------------------------------------------
	interface AuthorAcc {
		name: string;
		email: string;
		commits: number;
		additions: number;
		deletions: number;
		first: string;
		last: string;
		files: Set<string>;
		days: Set<string>;
	}
	const authors = new Map<string, AuthorAcc>();
	// People frequently commit under several e-mail addresses; group by normalised name instead.
	const authorKey = (c: ParsedCommit) => (c.author.trim() || c.email).toLowerCase().replace(/\s+/g, ' ');
	const emailCounts = new Map<string, Map<string, number>>();

	// ---- per file ---------------------------------------------------------------------------
	interface FileAcc {
		commits: number;
		recent: number;
		additions: number;
		deletions: number;
		authors: Map<string, number>;
		first: string;
		last: string;
	}
	const fileAccs = new Map<string, FileAcc>();

	const activity: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
	const buckets = new Map<string, { commits: number; additions: number; deletions: number; authors: Set<string> }>();

	const firstIso = commits[commits.length - 1].date;
	const lastIso = commits[0].date;
	const spanDays = (new Date(lastIso).getTime() - new Date(firstIso).getTime()) / DAY;
	const unit: 'week' | 'month' = spanDays > 730 ? 'month' : 'week';

	let commitsLast30d = 0;
	let commitsLast90d = 0;
	let commitsLast365d = 0;
	let mergeCommits = 0;
	let nonMergeCommits = 0;
	let totalFilesChanged = 0;
	let totalLinesChanged = 0;
	const activeAuthors90 = new Set<string>();

	for (const commit of commits) {
		const time = new Date(commit.date).getTime();
		const key = authorKey(commit);
		const parts = localParts(commit.date);
		let additions = 0;
		let deletions = 0;
		for (const f of commit.files) {
			additions += f.additions;
			deletions += f.deletions;
		}

		if (commit.isMerge) mergeCommits++;
		else {
			nonMergeCommits++;
			totalFilesChanged += commit.files.length;
			totalLinesChanged += additions + deletions;
		}
		if (time >= since30) commitsLast30d++;
		if (time >= since90) {
			commitsLast90d++;
			activeAuthors90.add(key);
		}
		if (time >= since365) commitsLast365d++;

		let author = authors.get(key);
		if (!author) {
			author = {
				name: commit.author,
				email: commit.email,
				commits: 0,
				additions: 0,
				deletions: 0,
				first: commit.date,
				last: commit.date,
				files: new Set(),
				days: new Set()
			};
			authors.set(key, author);
		}
		author.commits++;
		let emails = emailCounts.get(key);
		if (!emails) emailCounts.set(key, (emails = new Map()));
		emails.set(commit.email, (emails.get(commit.email) ?? 0) + 1);
		author.additions += additions;
		author.deletions += deletions;
		if (commit.date < author.first) author.first = commit.date;
		if (commit.date > author.last) author.last = commit.date;
		author.days.add(commit.date.slice(0, 10));

		activity[parts.weekday][parts.hour]++;

		const bucketKey =
			unit === 'month' ? monthKey(parts.y, parts.m) : weekStartKey(parts.y, parts.m, parts.d);
		let bucket = buckets.get(bucketKey);
		if (!bucket) buckets.set(bucketKey, (bucket = { commits: 0, additions: 0, deletions: 0, authors: new Set() }));
		bucket.commits++;
		bucket.additions += additions;
		bucket.deletions += deletions;
		bucket.authors.add(key);

		for (const f of commit.files) {
			author.files.add(f.path);
			let acc = fileAccs.get(f.path);
			if (!acc) {
				acc = {
					commits: 0,
					recent: 0,
					additions: 0,
					deletions: 0,
					authors: new Map(),
					first: commit.date,
					last: commit.date
				};
				fileAccs.set(f.path, acc);
			}
			acc.commits++;
			if (time >= since365) acc.recent++;
			acc.additions += f.additions;
			acc.deletions += f.deletions;
			acc.authors.set(key, (acc.authors.get(key) ?? 0) + 1);
			if (commit.date < acc.first) acc.first = commit.date;
			if (commit.date > acc.last) acc.last = commit.date;
		}
	}

	// ---- file-level results -------------------------------------------------------------------
	const fileGit = new Map<string, FileGitInfo>();
	const churn: GitFileChurn[] = [];
	const owned = new Map<string, number>();
	let singleAuthorFiles = 0;

	for (const [gitPath, acc] of fileAccs) {
		const projectPath = toProjectPath(gitPath);
		if (!projectPath) continue;
		let topKey = '';
		let topCount = 0;
		for (const [k, n] of acc.authors) {
			if (n > topCount) {
				topCount = n;
				topKey = k;
			}
		}
		const topAuthor = authors.get(topKey)?.name ?? topKey;
		const analyzed = analyzedFiles.has(projectPath);
		if (analyzed) {
			fileGit.set(projectPath, {
				commits: acc.commits,
				recentCommits: acc.recent,
				authors: acc.authors.size,
				additions: acc.additions,
				deletions: acc.deletions,
				firstCommit: acc.first,
				lastModified: acc.last,
				topAuthor,
				topAuthorShare: acc.commits ? topCount / acc.commits : 0
			});
			owned.set(topKey, (owned.get(topKey) ?? 0) + 1);
			if (acc.authors.size === 1) singleAuthorFiles++;
			churn.push({
				path: projectPath,
				commits: acc.commits,
				recentCommits: acc.recent,
				additions: acc.additions,
				deletions: acc.deletions,
				authors: acc.authors.size,
				lastModified: acc.last,
				analyzed: true
			});
		}
	}
	churn.sort((a, b) => b.commits - a.commits || b.recentCommits - a.recentCommits);

	const authorList: GitAuthor[] = [...authors.entries()]
		.map(([key, a]) => ({
			name: a.name,
			email: [...(emailCounts.get(key) ?? new Map<string, number>())].sort((x, y) => y[1] - x[1])[0]?.[0] ?? a.email,
			commits: a.commits,
			additions: a.additions,
			deletions: a.deletions,
			firstCommit: a.first,
			lastCommit: a.last,
			filesTouched: a.files.size,
			filesOwned: owned.get(key) ?? 0,
			activeDays: a.days.size
		}))
		.sort((a, b) => b.commits - a.commits || b.additions - a.additions);

	// ---- timeline with gap filling ------------------------------------------------------------
	const firstParts = localParts(firstIso);
	const lastParts = localParts(lastIso);
	let cursor =
		unit === 'month'
			? monthKey(firstParts.y, firstParts.m)
			: weekStartKey(firstParts.y, firstParts.m, firstParts.d);
	const endKey =
		unit === 'month'
			? monthKey(lastParts.y, lastParts.m)
			: weekStartKey(lastParts.y, lastParts.m, lastParts.d);
	const timeline: GitTimelinePoint[] = [];
	let guard = 0;
	while (cursor <= endKey && guard++ < 5000) {
		const b = buckets.get(cursor);
		timeline.push({
			period: cursor,
			commits: b?.commits ?? 0,
			additions: b?.additions ?? 0,
			deletions: b?.deletions ?? 0,
			authors: b?.authors.size ?? 0
		});
		cursor = nextPeriod(cursor, unit);
	}

	const recentCommits: GitCommit[] = commits.slice(0, 30).map((c) => {
		let additions = 0;
		let deletions = 0;
		for (const f of c.files) {
			additions += f.additions;
			deletions += f.deletions;
		}
		return {
			hash: c.hash,
			shortHash: c.hash.slice(0, 7),
			author: c.author,
			email: c.email,
			date: c.date,
			subject: c.subject,
			additions,
			deletions,
			files: c.files.length,
			isMerge: c.isMerge
		};
	});

	const stats: GitStats = {
		root: topLevel,
		scopedToSubdir: prefix || null,
		branch: branch ?? 'HEAD',
		remote: remote || null,
		totalCommits,
		analyzedCommits: commits.length,
		truncated: commits.length < totalCommits,
		firstCommit: firstIso,
		lastCommit: lastIso,
		authors: authorList,
		recentCommits,
		timeline,
		timelineUnit: unit,
		activity,
		fileChurn: churn.slice(0, 100),
		uncommittedChanges: status ? status.split('\n').filter((l) => l.trim()).length : 0,
		tagCount: tagList ? tagList.split('\n').filter(Boolean).length : 0,
		latestTag: latestTag || null,
		commitsLast30d,
		commitsLast90d,
		commitsLast365d,
		activeAuthorsLast90d: activeAuthors90.size,
		avgFilesPerCommit: nonMergeCommits ? totalFilesChanged / nonMergeCommits : 0,
		avgLinesPerCommit: nonMergeCommits ? totalLinesChanged / nonMergeCommits : 0,
		filesWithHistory: fileGit.size,
		singleAuthorFiles,
		mergeCommits
	};

	return { stats, fileGit, error: null };
}
