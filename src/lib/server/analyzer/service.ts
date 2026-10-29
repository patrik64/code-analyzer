import type { AnalysisProgress, AnalysisResult } from '#lib/types.js';
import { analyzeProject, resolveProjectPath } from './index';
import { getCachedAnalysis, setCachedAnalysis } from './cache';
import { describeProgress } from './progress';

const CACHE_TTL_MS = 10 * 60 * 1000;
const inFlight = new Map<string, Promise<AnalysisResult>>();

type ProgressSubscriber = (progress: AnalysisProgress) => void;
/** Latest progress of each running analysis, keyed by resolved project root. */
const progressByRoot = new Map<string, AnalysisProgress>();
const subscribers = new Map<string, Set<ProgressSubscriber>>();

function publish(root: string, progress: AnalysisProgress): void {
	progressByRoot.set(root, progress);
	const set = subscribers.get(root);
	if (set) for (const notify of set) notify(progress);
}

/** Analyse a project path with caching and de-duplication of concurrent requests. */
export async function getAnalysis(input: string, refresh = false): Promise<AnalysisResult> {
	const root = resolveProjectPath(input);
	if (!refresh) {
		const cached = getCachedAnalysis(root, CACHE_TTL_MS);
		if (cached) return cached;
	}
	let pending = inFlight.get(root);
	if (!pending) {
		const startedAt = Date.now();
		pending = analyzeProject(root, {
			onProgress: (update) => publish(root, describeProgress(update, startedAt))
		})
			.then(
				(result) => {
					setCachedAnalysis(root, result);
					return result;
				},
				(err: unknown) => {
					const fraction = progressByRoot.get(root)?.fraction ?? 0;
					publish(root, describeProgress({ phase: 'error', fraction, error: (err as Error).message }, startedAt));
					throw err;
				}
			)
			.finally(() => {
				inFlight.delete(root);
				progressByRoot.delete(root);
			});
		inFlight.set(root, pending);
	}
	return pending;
}

/**
 * Current progress of the analysis for `input`: the live state while it runs, `done` when a cached
 * result exists, otherwise a `queued` placeholder (nothing has asked for this path yet).
 */
export function getProgress(input: string): AnalysisProgress {
	const root = resolveProjectPath(input);
	const current = progressByRoot.get(root);
	if (current) return current;
	if (getCachedAnalysis(root, CACHE_TTL_MS)) return describeProgress({ phase: 'done' }, null);
	return describeProgress({ phase: 'queued' }, null);
}

/**
 * Be notified of every future progress update for `input`, including the analysis starting after
 * the subscription was made. Returns an unsubscribe function. Pair with `getProgress` for the
 * current state.
 */
export function subscribeProgress(input: string, subscriber: ProgressSubscriber): () => void {
	const root = resolveProjectPath(input);
	let set = subscribers.get(root);
	if (!set) subscribers.set(root, (set = new Set()));
	set.add(subscriber);
	return () => {
		set.delete(subscriber);
		if (set.size === 0) subscribers.delete(root);
	};
}
