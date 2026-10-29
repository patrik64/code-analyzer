const numberFormat = new Intl.NumberFormat('en-US');

export function fmt(n: number | null | undefined): string {
	if (n === null || n === undefined || !Number.isFinite(n)) return '–';
	return numberFormat.format(Math.round(n));
}

export function fixed(n: number | null | undefined, digits = 1): string {
	if (n === null || n === undefined || !Number.isFinite(n)) return '–';
	return n.toFixed(digits);
}

export function compact(n: number): string {
	if (!Number.isFinite(n)) return '–';
	const abs = Math.abs(n);
	if (abs >= 1e9) return `${trim(n / 1e9)}B`;
	if (abs >= 1e6) return `${trim(n / 1e6)}M`;
	if (abs >= 1e3) return `${trim(n / 1e3)}K`;
	return numberFormat.format(Math.round(n * 10) / 10);
}

function trim(v: number): string {
	const s = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
	return s.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

export function bytes(n: number): string {
	if (!Number.isFinite(n)) return '–';
	if (n < 1024) return `${n} B`;
	const units = ['KB', 'MB', 'GB'];
	let v = n / 1024;
	let i = 0;
	while (v >= 1024 && i < units.length - 1) {
		v /= 1024;
		i++;
	}
	return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function pct(ratio: number, digits = 0): string {
	if (!Number.isFinite(ratio)) return '–';
	return `${(ratio * 100).toFixed(digits)}%`;
}

const dateFormat = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
const dateTimeFormat = new Intl.DateTimeFormat('en-US', {
	year: 'numeric',
	month: 'short',
	day: 'numeric',
	hour: '2-digit',
	minute: '2-digit'
});

export function fmtDate(iso: string | null | undefined): string {
	if (!iso) return '–';
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? '–' : dateFormat.format(d);
}

export function fmtDateTime(iso: string | null | undefined): string {
	if (!iso) return '–';
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? '–' : dateTimeFormat.format(d);
}

export function ago(iso: string | null | undefined, now = Date.now()): string {
	if (!iso) return '–';
	const t = new Date(iso).getTime();
	if (Number.isNaN(t)) return '–';
	const diff = Math.max(0, now - t);
	const minutes = Math.round(diff / 60000);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
	const days = Math.round(hours / 24);
	if (days < 31) return `${days} day${days === 1 ? '' : 's'} ago`;
	const months = Math.round(days / 30.4);
	if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
	const years = diff / (365.25 * 24 * 3600 * 1000);
	const text = years < 10 ? years.toFixed(1).replace(/\.0$/, '') : String(Math.round(years));
	return `${text} year${text === '1' ? '' : 's'} ago`;
}

export function duration(ms: number): string {
	if (ms < 1000) return `${Math.round(ms)} ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
	return `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`;
}

export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
	return `${fmt(n)} ${n === 1 ? singular : pluralForm}`;
}

/** Shorten a path from the left, keeping the file name readable. */
export function shortPath(p: string, max = 48): string {
	if (p.length <= max) return p;
	const parts = p.split('/');
	let out = parts[parts.length - 1];
	for (let i = parts.length - 2; i >= 0; i--) {
		const next = `${parts[i]}/${out}`;
		if (next.length + 2 > max) return `…/${out}`;
		out = next;
	}
	return out;
}

export function reportHref(section: string, path: string, extra?: Record<string, string>): string {
	const params = new URLSearchParams({ path });
	if (extra) for (const [k, v] of Object.entries(extra)) if (v) params.set(k, v);
	return `/report${section ? `/${section}` : ''}?${params.toString()}`;
}
