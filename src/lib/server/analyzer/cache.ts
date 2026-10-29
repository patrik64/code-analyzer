import type { AnalysisResult } from '#lib/types.js';

const MAX_ENTRIES = 6;
const cache = new Map<string, { result: AnalysisResult; at: number }>();

export function getCachedAnalysis(key: string, ttlMs: number): AnalysisResult | null {
	const entry = cache.get(key);
	if (!entry) return null;
	if (Date.now() - entry.at > ttlMs) {
		cache.delete(key);
		return null;
	}
	return entry.result;
}

export function setCachedAnalysis(key: string, result: AnalysisResult): void {
	cache.set(key, { result, at: Date.now() });
	if (cache.size > MAX_ENTRIES) {
		const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
		if (oldest) cache.delete(oldest[0]);
	}
}

export function clearCachedAnalysis(key?: string): void {
	if (key) cache.delete(key);
	else cache.clear();
}
