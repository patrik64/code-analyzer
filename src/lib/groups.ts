import { OTHER_COLOR, series } from './colors.js';

export interface Group {
	key: string;
	label: string;
	/** categorical slot index, or null for the folded "Other" group */
	slot: number | null;
	files: number;
}

export interface Grouping {
	depth: number;
	groups: Group[];
	keyOf: (path: string) => string;
	colorOf: (path: string, dark: boolean) => string;
	slotOf: (key: string) => number | null;
}

const MAX_GROUPS = 7;

function prefix(path: string, depth: number): string {
	const parts = path.split('/');
	if (parts.length <= depth) return parts.length > 1 ? parts.slice(0, -1).join('/') : '(root)';
	return parts.slice(0, depth).join('/');
}

/**
 * Group files by directory prefix. With `depth` = 'auto' the shallowest depth that yields more
 * than one group is used (so a project that lives entirely under `src/` is split one level deeper).
 * The 7 largest groups get categorical slots; the rest fold into "Other".
 */
export function buildGrouping(paths: string[], depth: number | 'auto' = 'auto'): Grouping {
	let chosen = typeof depth === 'number' ? depth : 1;
	let counts = countBy(paths, chosen);
	if (depth === 'auto') {
		while (counts.size < 2 && chosen < 4) {
			const next = countBy(paths, chosen + 1);
			if (next.size <= counts.size && chosen > 1) break;
			chosen++;
			counts = next;
			if (next.size >= 2) break;
		}
	}
	const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
	const groups: Group[] = sorted.slice(0, MAX_GROUPS).map(([key, files], i) => ({
		key,
		label: key,
		slot: i,
		files
	}));
	const rest = sorted.slice(MAX_GROUPS);
	if (rest.length) {
		groups.push({
			key: '__other__',
			label: `Other (${rest.length} dirs)`,
			slot: null,
			files: rest.reduce((n, [, c]) => n + c, 0)
		});
	}
	const slotByKey = new Map(groups.map((g) => [g.key, g.slot]));
	const keyOf = (path: string) => {
		const k = prefix(path, chosen);
		return slotByKey.has(k) ? k : '__other__';
	};
	const slotOf = (key: string) => slotByKey.get(key) ?? null;
	return {
		depth: chosen,
		groups,
		keyOf,
		slotOf,
		colorOf: (path, dark) => {
			const slot = slotOf(keyOf(path));
			return slot === null ? OTHER_COLOR : series(slot, dark);
		}
	};
}

function countBy(paths: string[], depth: number): Map<string, number> {
	const counts = new Map<string, number>();
	for (const p of paths) {
		const k = prefix(p, depth);
		counts.set(k, (counts.get(k) ?? 0) + 1);
	}
	return counts;
}
