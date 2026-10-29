import { execFile, type ChildProcess } from 'node:child_process';
import { stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type FolderDialogResult =
	| { status: 'chosen'; path: string }
	| { status: 'cancelled' }
	| { status: 'unsupported'; reason: string };

/** Thrown when a dialog is already open: the desktop shows one at a time, and so do we. */
export class DialogBusyError extends Error {
	constructor() {
		super('A folder dialog is already open on this machine.');
	}
}

export interface FolderDialogOptions {
	/** Folder the dialog starts in; ignored unless it is an existing directory. */
	startIn?: string | null;
	prompt?: string;
	/** The dialog is closed and reported as cancelled after this long. */
	timeoutMs?: number;
	/** Closes the dialog when aborted (for example because the browser tab went away). */
	signal?: AbortSignal;
}

interface Candidate {
	cmd: string;
	args: string[];
	/** Whether a non-zero exit means the user dismissed the dialog rather than a failure. */
	isCancel: (code: number, stderr: string) => boolean;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
let busy = false;

async function isDirectory(p: string | null | undefined): Promise<boolean> {
	if (!p) return false;
	try {
		return (await stat(p)).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Native folder pickers per platform, tried in order (a missing command falls through to the next).
 * macOS is the one exercised in development; the Linux and Windows commands are best effort.
 */
function candidates(platform: NodeJS.Platform, prompt: string, startIn: string | null): Candidate[] {
	switch (platform) {
		case 'darwin': {
			// The prompt and start folder arrive as script arguments, so they are never spliced into
			// the script text. `activate` brings osascript's own dialog in front of the browser.
			const script = [
				'on run argv',
				'try',
				'activate',
				'end try',
				'set thePrompt to item 1 of argv',
				'set startIn to item 2 of argv',
				'if startIn is "" then',
				'set chosen to choose folder with prompt thePrompt',
				'else',
				'set chosen to choose folder with prompt thePrompt default location (POSIX file startIn)',
				'end if',
				'return POSIX path of chosen',
				'end run'
			].flatMap((line) => ['-e', line]);
			return [
				{
					cmd: 'osascript',
					args: [...script, prompt, startIn ?? ''],
					// "User canceled. (-128)"
					isCancel: (_code, stderr) => /-128\b/.test(stderr) || /cancel/i.test(stderr)
				}
			];
		}
		case 'linux':
			return [
				{
					cmd: 'zenity',
					args: [
						'--file-selection',
						'--directory',
						`--title=${prompt}`,
						...(startIn ? [`--filename=${startIn}${path.sep}`] : [])
					],
					isCancel: (code) => code === 1
				},
				{
					cmd: 'kdialog',
					args: ['--title', prompt, '--getexistingdirectory', startIn ?? os.homedir()],
					isCancel: (code) => code === 1
				}
			];
		case 'win32': {
			const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;
			const script = [
				'Add-Type -AssemblyName System.Windows.Forms',
				'$d = New-Object System.Windows.Forms.FolderBrowserDialog',
				`$d.Description = ${quote(prompt)}`,
				...(startIn ? [`$d.SelectedPath = ${quote(startIn)}`] : []),
				"if ($d.ShowDialog() -eq 'OK') { [Console]::Out.Write($d.SelectedPath) } else { exit 1 }"
			].join('; ');
			return [
				{ cmd: 'powershell', args: ['-NoProfile', '-STA', '-Command', script], isCancel: (code) => code === 1 }
			];
		}
		default:
			return [];
	}
}

/** Runs one picker; resolves `null` when its command is not installed. */
function runDialog(
	candidate: Candidate,
	timeoutMs: number,
	signal: AbortSignal | undefined
): Promise<FolderDialogResult | null> {
	return new Promise((resolve, reject) => {
		let child: ChildProcess | null = null;
		const onAbort = () => child?.kill();
		child = execFile(
			candidate.cmd,
			candidate.args,
			{ timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true },
			(error, stdout, stderr) => {
				signal?.removeEventListener('abort', onAbort);
				if (!error) {
					const chosen = String(stdout).trim();
					resolve(chosen ? { status: 'chosen', path: path.resolve(chosen) } : { status: 'cancelled' });
					return;
				}
				const err = error as NodeJS.ErrnoException & { killed?: boolean; code?: number | string | null };
				if (err.code === 'ENOENT') return resolve(null);
				// Killed: the timeout ran out or the caller aborted, which closes the dialog.
				if (err.killed || signal?.aborted) return resolve({ status: 'cancelled' });
				if (typeof err.code === 'number' && candidate.isCancel(err.code, String(stderr ?? ''))) {
					return resolve({ status: 'cancelled' });
				}
				reject(new Error(`The folder dialog failed: ${String(stderr ?? '').trim() || err.message}`));
			}
		);
		if (signal?.aborted) child.kill();
		else signal?.addEventListener('abort', onAbort, { once: true });
	});
}

/** Open the operating system's folder picker on this machine and resolve with the user's choice. */
export async function chooseFolder(options: FolderDialogOptions = {}): Promise<FolderDialogResult> {
	if (busy) throw new DialogBusyError();
	busy = true;
	try {
		const prompt = options.prompt ?? 'Choose a project folder to analyze';
		const startIn = (await isDirectory(options.startIn)) ? path.resolve(options.startIn!) : null;
		const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		for (const candidate of candidates(process.platform, prompt, startIn)) {
			const result = await runDialog(candidate, timeoutMs, options.signal);
			if (result) return result;
		}
		return {
			status: 'unsupported',
			reason:
				process.platform === 'linux'
					? 'No folder dialog is available: install zenity or kdialog.'
					: `No folder dialog is available on ${process.platform}.`
		};
	} finally {
		busy = false;
	}
}
