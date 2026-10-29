import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { AnalysisError } from '#lib/server/analyzer/index.js';
import { getAnalysis } from '#lib/server/analyzer/service.js';

/** JSON API: GET /api/analyze?path=/abs/or/relative/path[&refresh=1] */
export const GET: RequestHandler = async ({ url }) => {
	const input = url.searchParams.get('path');
	if (!input) return json({ error: 'Missing `path` query parameter.' }, { status: 400 });
	try {
		const result = await getAnalysis(input, url.searchParams.get('refresh') === '1');
		return json(result);
	} catch (err) {
		const status = err instanceof AnalysisError ? err.status : 500;
		return json({ error: (err as Error).message }, { status });
	}
};
