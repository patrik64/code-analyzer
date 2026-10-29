import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveProjectPath } from '#lib/server/analyzer/index.js';
import { DialogBusyError, chooseFolder } from '#lib/server/dialog.js';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Opens the operating system's folder picker on the machine running the server and returns the
 * choice: POST /api/choose-folder with an optional JSON body `{ path }` naming the folder to start in.
 *
 * Responds with `{ path }`, `{ cancelled: true }`, or `{ error }` (plus `unsupported: true` when this
 * system has no dialog to offer). Because the dialog appears on the server's own screen, only
 * loopback clients may open one. Closing the request (e.g. leaving the page) closes the dialog.
 */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	let address = '';
	try {
		address = getClientAddress();
	} catch {
		/* unknown: treated as remote */
	}
	if (!LOOPBACK.has(address)) {
		return json(
			{
				error:
					'The folder dialog opens on the machine running the server, so it is only available when the app is opened on that machine via localhost.'
			},
			{ status: 403 }
		);
	}

	let startIn: string | null = null;
	try {
		const body = (await request.json()) as { path?: unknown };
		if (typeof body.path === 'string' && body.path.trim()) startIn = resolveProjectPath(body.path);
	} catch {
		/* no or invalid body: start in the default location */
	}

	try {
		const result = await chooseFolder({ startIn, signal: request.signal });
		if (result.status === 'unsupported') return json({ error: result.reason, unsupported: true }, { status: 501 });
		if (result.status === 'cancelled') return json({ cancelled: true });
		return json({ path: result.path });
	} catch (err) {
		if (err instanceof DialogBusyError) return json({ error: err.message }, { status: 409 });
		return json({ error: (err as Error).message }, { status: 500 });
	}
};
