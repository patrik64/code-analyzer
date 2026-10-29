import type { Language } from './types.js';

/** Categorical slots in fixed, CVD-validated order (light / dark steps). */
export const SERIES_LIGHT = [
	'#2a78d6',
	'#eb6834',
	'#1baf7a',
	'#eda100',
	'#e87ba4',
	'#008300',
	'#6250d6',
	'#e34948'
];
export const SERIES_DARK = [
	'#3987e5',
	'#d95926',
	'#199e70',
	'#c98500',
	'#d55181',
	'#008300',
	'#9085e9',
	'#e66767'
];

/** Single-hue sequential ramp (blue), light → dark. */
export const SEQUENTIAL = [
	'#cde2fb',
	'#b7d3f6',
	'#9ec5f4',
	'#86b6ef',
	'#6da7ec',
	'#5598e7',
	'#3987e5',
	'#2a78d6',
	'#256abf',
	'#1c5cab',
	'#184f95',
	'#104281',
	'#0d366b'
];

export const OTHER_COLOR = '#898781';

export const STATUS = {
	good: '#0ca30c',
	warning: '#fab219',
	serious: '#ec835a',
	critical: '#d03b3b'
} as const;

/** Each language always maps to the same slot so colours follow the entity. */
export const LANGUAGE_SLOT: Record<Language, number> = {
	ts: 0,
	js: 1,
	tsx: 2,
	jsx: 3,
	svelte: 4,
	vue: 5
};

export const LANGUAGE_LABEL: Record<Language, string> = {
	ts: 'TypeScript',
	tsx: 'TSX',
	js: 'JavaScript',
	jsx: 'JSX',
	svelte: 'Svelte',
	vue: 'Vue'
};

export const LANGUAGE_ORDER: Language[] = ['ts', 'js', 'tsx', 'jsx', 'svelte', 'vue'];

export function series(index: number, dark: boolean): string {
	const palette = dark ? SERIES_DARK : SERIES_LIGHT;
	return index < 0 || index >= palette.length ? OTHER_COLOR : palette[index];
}

export function languageColor(language: Language | 'external', dark: boolean): string {
	if (language === 'external') return OTHER_COLOR;
	return series(LANGUAGE_SLOT[language], dark);
}

export function sequential(t: number): string {
	const i = Math.max(0, Math.min(SEQUENTIAL.length - 1, Math.round(t * (SEQUENTIAL.length - 1))));
	return SEQUENTIAL[i];
}

export function withAlpha(hex: string, alpha: number): string {
	const h = hex.replace('#', '');
	const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
	const r = (n >> 16) & 255;
	const g = (n >> 8) & 255;
	const b = n & 255;
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export interface Chrome {
	bg: string;
	surface: string;
	surface2: string;
	text: string;
	text2: string;
	muted: string;
	grid: string;
	axis: string;
	border: string;
	accent: string;
}

export function chrome(dark: boolean): Chrome {
	return dark
		? {
				bg: '#0d0d0d',
				surface: '#1a1a19',
				surface2: '#232322',
				text: '#f0efec',
				text2: '#c3c2b7',
				muted: '#898781',
				grid: '#2c2c2a',
				axis: '#383835',
				border: 'rgba(255,255,255,0.10)',
				accent: '#3987e5'
			}
		: {
				bg: '#f9f9f7',
				surface: '#fcfcfb',
				surface2: '#f1f0ec',
				text: '#0b0b0b',
				text2: '#52514e',
				muted: '#898781',
				grid: '#e1e0d9',
				axis: '#c3c2b7',
				border: 'rgba(11,11,11,0.10)',
				accent: '#2a78d6'
			};
}
