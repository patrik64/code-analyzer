import type { AnalysisPhase, AnalysisProgress } from '#lib/types.js';

/** A raw notification from the pipeline: the step it is in and, when known, how far along it is. */
export interface PhaseUpdate {
	phase: AnalysisPhase;
	done?: number;
	total?: number;
	/** Overall completion 0–1 as estimated by the reporter; absent for synthetic updates. */
	fraction?: number;
	error?: string;
}

export type ProgressListener = (update: PhaseUpdate) => void;

/** Amount of work ahead, used to split the bar between the two long phases. */
export interface WorkPlan {
	files?: number;
	commits?: number;
}

export interface ProgressReporter {
	/** Announce how much work the parse / git phases have, as soon as it is known. */
	plan(work: WorkPlan): void;
	/** Enter a phase. Always forwarded. */
	phase(phase: AnalysisPhase, done?: number, total?: number): void;
	/** Update the counts within a phase. Throttled, except for the final item of the phase. */
	count(phase: AnalysisPhase, done: number, total: number): void;
}

type Span = readonly [start: number, end: number];

/*
 * Layout of the bar. Scan and project metadata get small fixed slots at the start, aggregation a
 * small one at the end. The stretch in between belongs to parsing and git history, which are the
 * phases that take real time; how it is divided between them depends on the amount of work each has
 * (see `plan`). Git runs in the background while files are parsed, so its slot only becomes live
 * once the pipeline is actually waiting for it.
 */
const SCAN: Span = [0, 0.06];
const PROJECT: Span = [0.06, 0.08];
const GRAPH_WIDTH = 0.03;
const EXTERNALS_WIDTH = 0.02;
const AGGREGATE: Span = [0.97, 1];
/** Used until the real amount of work is known; roughly "git is a sixth of the wait". */
const DEFAULT_GIT_SHARE = 0.17;
/** Rough relative cost of the two long phases: parsing one file ≈ reading three commits of history. */
const FILE_COST = 3;
const COMMIT_COST = 1;
/** Minimum time between two count updates of the same phase that are forwarded to listeners. */
const MIN_INTERVAL_MS = 100;

const PHASE_ORDER: AnalysisPhase[] = [
	'queued',
	'scan',
	'project',
	'parse',
	'graph',
	'externals',
	'git',
	'aggregate',
	'done',
	'error'
];

const PHASE_LABEL: Record<AnalysisPhase, string> = {
	queued: 'Waiting for the analysis to start',
	scan: 'Finding source files',
	project: 'Reading project metadata',
	parse: 'Parsing files',
	graph: 'Building the import graph',
	externals: 'Resolving external dependencies',
	git: 'Reading git history',
	aggregate: 'Summarizing',
	done: 'Done',
	error: 'Analysis failed'
};

/** Where parsing should end when the remaining stretch from `from` is split with `gitShare` for git. */
function parseEndFor(from: number, gitShare: number): number {
	const variable = AGGREGATE[0] - from - GRAPH_WIDTH - EXTERNALS_WIDTH;
	return from + variable * (1 - gitShare);
}

function layout(parseEnd: number): Record<AnalysisPhase, Span> {
	const graphEnd = parseEnd + GRAPH_WIDTH;
	const externalsEnd = graphEnd + EXTERNALS_WIDTH;
	return {
		queued: [0, 0],
		scan: SCAN,
		project: PROJECT,
		parse: [PROJECT[1], parseEnd],
		graph: [parseEnd, graphEnd],
		externals: [graphEnd, externalsEnd],
		git: [externalsEnd, AGGREGATE[0]],
		aggregate: AGGREGATE,
		done: [1, 1],
		error: [1, 1]
	};
}

/** Turn a pipeline notification into the shape that is streamed to clients. */
export function describeProgress(update: PhaseUpdate, startedAt: number | null): AnalysisProgress {
	const total = update.total !== undefined && update.total > 0 ? update.total : null;
	const done = total !== null && update.done !== undefined ? Math.min(total, Math.max(0, update.done)) : null;
	return {
		phase: update.phase,
		message: PHASE_LABEL[update.phase],
		fraction: update.fraction ?? (update.phase === 'done' ? 1 : 0),
		done,
		total,
		elapsedMs: startedAt === null ? 0 : Math.max(0, Date.now() - startedAt),
		error: update.error ?? null
	};
}

/**
 * Wrap an optional listener so the pipeline can report freely without flooding it. The reporter
 * owns the mapping from phase + counts to the overall fraction, which never decreases: when the
 * layout is re-planned under a running phase, that phase simply continues from where the bar is.
 */
export function createProgressReporter(listener?: ProgressListener): ProgressReporter {
	let spans = layout(parseEndFor(PROJECT[1], DEFAULT_GIT_SHARE));
	let files: number | null = null;
	let commits: number | null = null;
	/** The last update that was emitted. */
	let current: { phase: AnalysisPhase; done?: number; total?: number; fraction: number } = {
		phase: 'queued',
		fraction: 0
	};
	/** Position of a phase when the layout changed under it; its remaining items fill the rest of its span. */
	let anchor: { phase: AnalysisPhase; done: number; fraction: number } | null = null;
	let lastTime = -Infinity;

	const emit = (phase: AnalysisPhase, done?: number, total?: number) => {
		const [start, end] = spans[phase];
		let fraction: number;
		if (anchor?.phase === phase && done !== undefined && total !== undefined && total > anchor.done) {
			fraction = anchor.fraction + (end - anchor.fraction) * ((done - anchor.done) / (total - anchor.done));
		} else {
			const within = done !== undefined && total !== undefined && total > 0 ? done / total : 0;
			fraction = start + (end - start) * within;
		}
		fraction = Math.min(1, Math.max(current.fraction, fraction));
		current = { phase, done, total, fraction };
		lastTime = performance.now();
		listener?.({ phase, done, total, fraction });
	};

	return {
		plan: (work) => {
			if (work.files !== undefined) files = work.files;
			if (work.commits !== undefined) commits = work.commits;
			if (files === null || commits === null) return;
			if (PHASE_ORDER.indexOf(current.phase) > PHASE_ORDER.indexOf('parse')) return; // nothing left to split
			let parseWork = files * FILE_COST;
			const gitWork = commits * COMMIT_COST;
			let from = PROJECT[1];
			anchor = null;
			if (current.phase === 'parse' && current.done !== undefined && current.total) {
				// Mid-parse: keep what the bar already shows and divide only the stretch ahead.
				parseWork *= 1 - current.done / current.total;
				from = current.fraction;
				anchor = { phase: 'parse', done: current.done, fraction: current.fraction };
			}
			const share = parseWork + gitWork > 0 ? gitWork / (parseWork + gitWork) : DEFAULT_GIT_SHARE;
			spans = layout(parseEndFor(from, Math.min(0.9, Math.max(0.02, share))));
		},
		phase: (phase, done, total) => emit(phase, done, total),
		count: (phase, done, total) => {
			if (!listener) return;
			if (done < total && performance.now() - lastTime < MIN_INTERVAL_MS) return;
			emit(phase, done, total);
		}
	};
}
