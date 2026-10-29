export interface Column<T> {
	key: string;
	label: string;
	align?: 'left' | 'right';
	width?: string;
	sortable?: boolean;
	/** Raw value used for sorting (and default display). */
	value?: (row: T) => number | string | null | undefined;
	/** Display text; defaults to the raw value. */
	format?: (row: T) => string;
	/** Cell tooltip. */
	title?: (row: T) => string;
	/** Header tooltip explaining the metric. */
	hint?: string;
	mono?: boolean;
}

export function rawValue<T>(row: T, col: Column<T>): number | string | null | undefined {
	if (col.value) return col.value(row);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (row as any)[col.key];
}

export function cellText<T>(row: T, col: Column<T>): string {
	if (col.format) return col.format(row);
	const v = rawValue(row, col);
	if (v === null || v === undefined) return '–';
	return typeof v === 'number' ? v.toLocaleString() : String(v);
}

export function compareValues(a: unknown, b: unknown): number {
	const aNull = a === null || a === undefined || a === '';
	const bNull = b === null || b === undefined || b === '';
	if (aNull && bNull) return 0;
	if (aNull) return 1;
	if (bNull) return -1;
	if (typeof a === 'number' && typeof b === 'number') return a - b;
	return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}
