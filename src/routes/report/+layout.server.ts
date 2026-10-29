import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { AnalysisError } from '#lib/server/analyzer/index.js';
import { getAnalysis } from '#lib/server/analyzer/service.js';
import type { AnalysisResult } from '#lib/types.js';

export const load: LayoutServerLoad = async ({ url }) => {
	const input = url.searchParams.get('path');
	if (!input) redirect(303, '/');
	const refresh = url.searchParams.get('refresh') === '1';

	let analysis: AnalysisResult;
	try {
		analysis = await getAnalysis(input, refresh);
	} catch (err) {
		const status = err instanceof AnalysisError ? err.status : 500;
		error(status, (err as Error).message);
	}

	if (refresh) {
		const clean = new URL(url);
		clean.searchParams.delete('refresh');
		redirect(303, clean.pathname + clean.search);
	}

	return { analysis };
};
