import { browser } from '$app/env';

export type ThemeMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'code-analyzer-theme';

function readMode(): ThemeMode {
	if (!browser) return 'system';
	try {
		const v = localStorage.getItem(STORAGE_KEY);
		return v === 'light' || v === 'dark' ? v : 'system';
	} catch {
		return 'system';
	}
}

function systemDark(): boolean {
	return browser ? window.matchMedia('(prefers-color-scheme: dark)').matches : false;
}

class ThemeState {
	mode = $state<ThemeMode>(readMode());
	#systemDark = $state(systemDark());

	constructor() {
		if (browser) {
			const mq = window.matchMedia('(prefers-color-scheme: dark)');
			mq.addEventListener('change', (e) => (this.#systemDark = e.matches));
		}
	}

	get isDark(): boolean {
		return this.mode === 'dark' || (this.mode === 'system' && this.#systemDark);
	}

	set(mode: ThemeMode) {
		this.mode = mode;
		if (!browser) return;
		try {
			if (mode === 'system') localStorage.removeItem(STORAGE_KEY);
			else localStorage.setItem(STORAGE_KEY, mode);
		} catch {
			/* ignore */
		}
		if (mode === 'system') document.documentElement.removeAttribute('data-theme');
		else document.documentElement.setAttribute('data-theme', mode);
	}

	cycle() {
		this.set(this.mode === 'system' ? 'light' : this.mode === 'light' ? 'dark' : 'system');
	}
}

export const theme = new ThemeState();
