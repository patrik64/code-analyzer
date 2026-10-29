import { json } from '@sveltejs/kit';
import { readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RequestHandler } from './$types';
import { resolveProjectPath } from '#lib/server/analyzer/index.js';

export interface BrowseEntry {
	name: string;
	path: string;
	hasPackageJson: boolean;
	isGitRepo: boolean;
}

export interface BrowseResponse {
	path: string;
	parent: string | null;
	isProject: boolean;
	entries: BrowseEntry[];
	error?: string;
}

async function exists(p: string): Promise<boolean> {
	try {
		await stat(p);
		return true;
	} catch {
		return false;
	}
}

/** Folder browser for the home page: GET /api/browse?path=/some/dir[&hidden=1] */
export const GET: RequestHandler = async ({ url }) => {
	const input = url.searchParams.get('path');
	const showHidden = url.searchParams.get('hidden') === '1';
	let dir: string;
	try {
		dir = input ? resolveProjectPath(input) : os.homedir();
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}

	let entries: import('node:fs').Dirent[];
	try {
		const info = await stat(dir);
		if (!info.isDirectory()) return json({ error: `${dir} is not a directory.` }, { status: 400 });
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return json({ error: `Cannot read ${dir}.` }, { status: 404 });
	}

	const dirs = entries
		.filter((e) => e.isDirectory() && (showHidden || !e.name.startsWith('.')))
		.filter((e) => e.name !== 'node_modules')
		.sort((a, b) => a.name.localeCompare(b.name))
		.slice(0, 1000);

	const result: BrowseEntry[] = await Promise.all(
		dirs.map(async (e) => {
			const abs = path.join(dir, e.name);
			const [hasPackageJson, isGitRepo] = await Promise.all([
				exists(path.join(abs, 'package.json')),
				exists(path.join(abs, '.git'))
			]);
			return { name: e.name, path: abs, hasPackageJson, isGitRepo };
		})
	);

	const parent = path.dirname(dir);
	const response: BrowseResponse = {
		path: dir,
		parent: parent === dir ? null : parent,
		isProject: await exists(path.join(dir, 'package.json')),
		entries: result
	};
	return json(response);
};
