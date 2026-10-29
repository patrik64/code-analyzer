import { execFile } from 'node:child_process';

export interface RunResult {
	stdout: string;
	stderr: string;
}

export class CommandError extends Error {
	constructor(
		message: string,
		public readonly stderr: string,
		public readonly code: number | string | null
	) {
		super(message);
	}
}

export interface RunOptions {
	maxBuffer?: number;
	timeout?: number;
	/** Observe stdout as it arrives (the complete output is still buffered and returned). */
	onStdout?: (chunk: string) => void;
}

/** Run a command without a shell (safe for paths with spaces) and capture stdout. */
export function run(cmd: string, args: string[], cwd: string, options: RunOptions = {}): Promise<RunResult> {
	return new Promise((resolve, reject) => {
		const child = execFile(
			cmd,
			args,
			{
				cwd,
				encoding: 'utf8',
				maxBuffer: options.maxBuffer ?? 512 * 1024 * 1024,
				timeout: options.timeout ?? 180_000,
				env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }
			},
			(error, stdout, stderr) => {
				if (error) {
					const err = error as NodeJS.ErrnoException & { code?: number | string };
					reject(new CommandError(err.message, String(stderr ?? ''), err.code ?? null));
				} else {
					resolve({ stdout: String(stdout), stderr: String(stderr) });
				}
			}
		);
		const onStdout = options.onStdout;
		if (onStdout && child.stdout) {
			child.stdout.on('data', (chunk: string | Buffer) =>
				onStdout(typeof chunk === 'string' ? chunk : chunk.toString('utf8'))
			);
		}
	});
}
