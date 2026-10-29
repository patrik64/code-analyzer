import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { AnalysisError, resolveProjectPath } from '#lib/server/analyzer/index.js';
import { getProgress, subscribeProgress } from '#lib/server/analyzer/service.js';
import type { AnalysisProgress } from '#lib/types.js';

/** Comment lines keep idle connections (and any proxy in between) from timing out. */
const HEARTBEAT_MS = 15_000;

/**
 * Live progress of an analysis as server-sent events:
 * GET /api/analyze/progress?path=/abs/path/to/project
 *
 * Every `data:` line is a JSON `AnalysisProgress`. The first event is the current state, which is
 * `queued` when nothing has requested this path yet; the real updates follow as soon as `/report`
 * or `/api/analyze` starts the work. The stream ends after the `done` or `error` event.
 */
export const GET: RequestHandler = ({ url, request }) => {
	const input = url.searchParams.get('path');
	if (!input) return json({ error: 'Missing `path` query parameter.' }, { status: 400 });
	try {
		resolveProjectPath(input);
	} catch (err) {
		const status = err instanceof AnalysisError ? err.status : 500;
		return json({ error: (err as Error).message }, { status });
	}

	const encoder = new TextEncoder();
	let close = () => {};
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let closed = false;
			const write = (text: string) => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(text));
				} catch {
					close(); // the client went away
				}
			};
			const send = (progress: AnalysisProgress) => {
				write(`data: ${JSON.stringify(progress)}\n\n`);
				if (progress.phase === 'done' || progress.phase === 'error') close();
			};

			const heartbeat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS);
			const unsubscribe = subscribeProgress(input, send);
			close = () => {
				if (closed) return;
				closed = true;
				clearInterval(heartbeat);
				unsubscribe();
				request.signal.removeEventListener('abort', close);
				try {
					controller.close();
				} catch {
					/* already closed by the consumer */
				}
			};
			request.signal.addEventListener('abort', close);
			if (request.signal.aborted) close();

			// Subscribed first, snapshot second: no update between the two can be missed.
			send(getProgress(input));
		},
		cancel() {
			close();
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
};
