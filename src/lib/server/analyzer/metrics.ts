import type { FunctionInfo, FunctionKind, ImportInfo, Language } from '#lib/types.js';
import { grammarFor, parseSource, type SyntaxNode } from './parser';

export interface SourceMetrics {
	loc: number;
	sloc: number;
	commentLines: number;
	blankLines: number;
	functions: FunctionInfo[];
	classes: string[];
	imports: ImportInfo[];
	exportCount: number;
	hasDefaultExport: boolean;
	complexity: number;
	maxComplexity: number;
	maxDepth: number;
	typeDefs: number;
	jsxElements: number;
	anyCount: number;
	tsDirectives: number;
	consoleCalls: number;
	todos: number;
	syntaxErrors: number;
}

const FUNCTION_TYPES = new Set([
	'function_declaration',
	'generator_function_declaration',
	'function_expression',
	'function',
	'generator_function',
	'arrow_function',
	'method_definition'
]);

const DECISION_TYPES = new Set([
	'if_statement',
	'for_statement',
	'for_in_statement',
	'while_statement',
	'do_statement',
	'switch_case',
	'catch_clause',
	'ternary_expression',
	'conditional_type'
]);

const BLOCK_TYPES = new Set(['statement_block', 'class_body', 'switch_body']);
const LOGICAL_OPERATORS = new Set(['&&', '||', '??']);
const LEAF_TYPES = new Set([
	'string',
	'number',
	'identifier',
	'property_identifier',
	'type_identifier',
	'regex',
	'true',
	'false',
	'null',
	'undefined',
	'this'
]);

const TODO_RE = /\b(TODO|FIXME|HACK|XXX)\b/gi;
const TS_DIRECTIVE_RE = /@ts-(ignore|expect-error|nocheck)\b/g;

interface Frame {
	node: SyntaxNode;
	depth: number;
	fn: FunctionInfo | null;
	cls: string | null;
	exportScope: boolean;
}

interface RowState {
	/** Non-whitespace characters per line that are not inside a comment. */
	codeChars: Int32Array;
	hasComment: Uint8Array;
}

interface ScriptBlock {
	code: string;
	lang: string | null;
	startRow: number;
	startCol: number;
}

export function splitLines(text: string): string[] {
	const lines = text.split('\n');
	if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
	return lines;
}

function countNonWhitespace(s: string): number {
	let n = 0;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c !== 32 && c !== 9 && c !== 13 && c !== 10 && c !== 12 && c !== 11) n++;
	}
	return n;
}

function stripQuotes(s: string): string {
	return s.replace(/^['"`]/, '').replace(/['"`]$/, '');
}

function truncate(s: string, max: number): string {
	const oneLine = s.replace(/\s+/g, ' ').trim();
	return oneLine.length > max ? oneLine.slice(0, max - 1) + '…' : oneLine;
}

function extractScriptBlocks(text: string): ScriptBlock[] {
	const blocks: ScriptBlock[] = [];
	const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text))) {
		const attrs = m[1];
		const code = m[2];
		const langMatch = /\blang\s*=\s*["']?([\w-]+)/i.exec(attrs);
		const codeStart = m.index + m[0].indexOf('>') + 1;
		const before = text.slice(0, codeStart);
		let startRow = 0;
		for (let i = 0; i < before.length; i++) if (before.charCodeAt(i) === 10) startRow++;
		const startCol = codeStart - (before.lastIndexOf('\n') + 1);
		blocks.push({ code, lang: langMatch ? langMatch[1] : null, startRow, startCol });
	}
	return blocks;
}

/** Parse a source file with tree-sitter and extract metrics. */
export function analyzeSource(text: string, language: Language): SourceMetrics {
	const lines = splitLines(text);
	const rowState: RowState = {
		codeChars: new Int32Array(lines.length),
		hasComment: new Uint8Array(lines.length)
	};
	for (let i = 0; i < lines.length; i++) rowState.codeChars[i] = countNonWhitespace(lines[i]);

	const metrics: SourceMetrics = {
		loc: lines.length,
		sloc: 0,
		commentLines: 0,
		blankLines: 0,
		functions: [],
		classes: [],
		imports: [],
		exportCount: 0,
		hasDefaultExport: false,
		complexity: 0,
		maxComplexity: 0,
		maxDepth: 0,
		typeDefs: 0,
		jsxElements: 0,
		anyCount: 0,
		tsDirectives: 0,
		consoleCalls: 0,
		todos: 0,
		syntaxErrors: 0
	};

	let moduleComplexity = 0;

	if (language === 'svelte' || language === 'vue') {
		for (const block of extractScriptBlocks(text)) {
			const tree = parseSource(block.code, grammarFor(language, block.lang));
			moduleComplexity += walk(tree.rootNode, metrics, {
				lineOffset: block.startRow,
				blockLines: splitLines(block.code),
				rowState
			});
		}
	} else {
		const tree = parseSource(text, grammarFor(language));
		moduleComplexity += walk(tree.rootNode, metrics, { lineOffset: 0, blockLines: lines, rowState });
	}

	for (let i = 0; i < lines.length; i++) {
		if (countNonWhitespace(lines[i]) === 0) metrics.blankLines++;
		else if (rowState.hasComment[i] && rowState.codeChars[i] <= 0) metrics.commentLines++;
		else metrics.sloc++;
	}

	let total = moduleComplexity;
	let max = 0;
	for (const fn of metrics.functions) {
		total += fn.complexity;
		if (fn.complexity > max) max = fn.complexity;
	}
	metrics.complexity = total;
	metrics.maxComplexity = max;
	return metrics;
}

interface WalkContext {
	lineOffset: number;
	blockLines: string[];
	rowState: RowState;
}

/** Walk the syntax tree iteratively and fill `metrics`. Returns module-level complexity. */
function walk(root: SyntaxNode, metrics: SourceMetrics, ctx: WalkContext): number {
	const { lineOffset, blockLines, rowState } = ctx;
	let moduleComplexity = 0;

	const addDecision = (fn: FunctionInfo | null) => {
		if (fn) fn.complexity++;
		else moduleComplexity++;
	};

	const markComment = (node: SyntaxNode) => {
		const start = node.startPosition;
		const end = node.endPosition;
		for (let r = start.row; r <= end.row; r++) {
			const fileRow = r + lineOffset;
			if (fileRow < 0 || fileRow >= rowState.codeChars.length) continue;
			const line = blockLines[r] ?? '';
			const from = r === start.row ? start.column : 0;
			const to = r === end.row ? end.column : line.length;
			rowState.codeChars[fileRow] -= countNonWhitespace(line.slice(from, to));
			rowState.hasComment[fileRow] = 1;
		}
	};

	const handleComment = (node: SyntaxNode) => {
		markComment(node);
		const text = node.text;
		const todos = text.match(TODO_RE);
		if (todos) metrics.todos += todos.length;
		const directives = text.match(TS_DIRECTIVE_RE);
		if (directives) metrics.tsDirectives += directives.length;
	};

	const lineOf = (node: SyntaxNode) => node.startPosition.row + lineOffset + 1;

	const pushImport = (partial: Omit<ImportInfo, 'target' | 'resolved' | 'packageName'>) => {
		metrics.imports.push({ ...partial, target: 'unresolved', resolved: null, packageName: null });
	};

	const stack: Frame[] = [{ node: root, depth: 0, fn: null, cls: null, exportScope: false }];

	while (stack.length) {
		const frame = stack.pop()!;
		const { node, depth, fn, cls, exportScope } = frame;
		const type = node.type;

		if (node.isMissing) metrics.syntaxErrors++;
		// Anonymous nodes are keywords/punctuation (their type is the literal text, e.g. 'function').
		if (!node.isNamed || LEAF_TYPES.has(type)) continue;

		let childDepth = depth;
		let childFn = fn;
		let childCls = cls;
		let childExport = exportScope;
		let descend = true;

		if (FUNCTION_TYPES.has(type)) {
			const info = makeFunction(node, type, cls, exportScope, lineOffset);
			metrics.functions.push(info);
			childFn = info;
			childExport = false;
		} else {
			switch (type) {
				case 'ERROR':
					metrics.syntaxErrors++;
					break;
				case 'comment':
					handleComment(node);
					descend = false;
					break;
				case 'import_statement': {
					const source = node.childForFieldName('source');
					if (source) {
						const clause = node.children.find((c) => c.type === 'import_clause') ?? null;
						pushImport({
							source: stripQuotes(source.text),
							kind: 'static',
							typeOnly: node.children.some((c) => !c.isNamed && c.type === 'type'),
							names: importNames(clause),
							line: lineOf(node)
						});
					}
					descend = false;
					break;
				}
				case 'export_statement': {
					handleExport(node);
					childExport = true;
					break;
				}
				case 'class_declaration':
				case 'abstract_class_declaration':
				case 'class': {
					const name =
						node.childForFieldName('name')?.text ??
						(type === 'class' ? deriveName(node) : '<anonymous class>');
					metrics.classes.push(truncate(name, 80));
					childCls = name;
					break;
				}
				case 'interface_declaration':
				case 'type_alias_declaration':
				case 'enum_declaration':
					metrics.typeDefs++;
					break;
				case 'call_expression':
					handleCall(node);
					break;
				case 'assignment_expression': {
					const left = node.childForFieldName('left');
					if (left && left.type === 'member_expression') {
						const text = left.text;
						if (text === 'module.exports') {
							metrics.hasDefaultExport = true;
							metrics.exportCount++;
						} else if (text.startsWith('module.exports.') || text.startsWith('exports.')) {
							metrics.exportCount++;
						}
					}
					break;
				}
				case 'predefined_type':
					if (node.text === 'any') metrics.anyCount++;
					descend = false;
					break;
				case 'jsx_element':
				case 'jsx_self_closing_element':
					metrics.jsxElements++;
					break;
				case 'binary_expression': {
					const op = node.childForFieldName('operator');
					if (op && LOGICAL_OPERATORS.has(op.type)) addDecision(fn);
					break;
				}
				default:
					if (BLOCK_TYPES.has(type)) {
						childDepth = depth + 1;
						if (childDepth > metrics.maxDepth) metrics.maxDepth = childDepth;
					} else if (DECISION_TYPES.has(type)) {
						addDecision(fn);
					}
			}
		}

		if (!descend) continue;
		const children = node.children;
		for (let i = children.length - 1; i >= 0; i--) {
			stack.push({
				node: children[i],
				depth: childDepth,
				fn: childFn,
				cls: childCls,
				exportScope: childExport
			});
		}
	}

	return moduleComplexity;

	function handleExport(node: SyntaxNode) {
		const source = node.childForFieldName('source');
		const clause = node.children.find((c) => c.type === 'export_clause') ?? null;
		const specifiers = clause
			? clause.namedChildren.filter((c) => c.type === 'export_specifier')
			: [];
		if (node.children.some((c) => !c.isNamed && c.type === 'default')) {
			metrics.hasDefaultExport = true;
		}
		if (source) {
			pushImport({
				source: stripQuotes(source.text),
				kind: 'reexport',
				typeOnly: node.children.some((c) => !c.isNamed && c.type === 'type'),
				names: specifiers.length
					? specifiers.map((s) => (s.childForFieldName('alias') ?? s.childForFieldName('name'))?.text ?? s.text)
					: ['*'],
				line: lineOf(node)
			});
			metrics.exportCount += Math.max(1, specifiers.length);
			return;
		}
		if (specifiers.length) {
			metrics.exportCount += specifiers.length;
			return;
		}
		const declaration = node.childForFieldName('declaration');
		if (
			declaration &&
			(declaration.type === 'lexical_declaration' || declaration.type === 'variable_declaration')
		) {
			metrics.exportCount += Math.max(
				1,
				declaration.namedChildren.filter((c) => c.type === 'variable_declarator').length
			);
		} else {
			metrics.exportCount++;
		}
	}

	function handleCall(node: SyntaxNode) {
		const callee = node.childForFieldName('function');
		if (!callee) return;
		const args = node.childForFieldName('arguments');
		const firstArg = args?.namedChildren[0] ?? null;
		if (callee.type === 'import') {
			if (firstArg && (firstArg.type === 'string' || firstArg.type === 'template_string')) {
				const source = stripQuotes(firstArg.text);
				if (!source.includes('${')) {
					pushImport({ source, kind: 'dynamic', typeOnly: false, names: [], line: lineOf(node) });
				}
			}
		} else if (callee.type === 'identifier' && callee.text === 'require') {
			if (firstArg && firstArg.type === 'string') {
				const parent = node.parent;
				const binding =
					parent?.type === 'variable_declarator' ? parent.childForFieldName('name')?.text : undefined;
				pushImport({
					source: stripQuotes(firstArg.text),
					kind: 'require',
					typeOnly: false,
					names: binding ? [truncate(binding, 60)] : [],
					line: lineOf(node)
				});
			}
		} else if (callee.type === 'member_expression') {
			const object = callee.childForFieldName('object');
			if (object && object.type === 'identifier' && object.text === 'console') metrics.consoleCalls++;
		}
	}
}

function importNames(clause: SyntaxNode | null): string[] {
	if (!clause) return [];
	const names: string[] = [];
	for (const child of clause.namedChildren) {
		if (child.type === 'identifier') {
			names.push(child.text);
		} else if (child.type === 'namespace_import') {
			const id = child.namedChildren.find((n) => n.type === 'identifier');
			names.push(`* as ${id?.text ?? '?'}`);
		} else if (child.type === 'named_imports') {
			for (const spec of child.namedChildren) {
				if (spec.type !== 'import_specifier') continue;
				const alias = spec.childForFieldName('alias');
				const name = spec.childForFieldName('name');
				names.push(alias?.text ?? name?.text ?? spec.text);
			}
		}
	}
	return names;
}

function countParams(node: SyntaxNode): number {
	const params = node.childForFieldName('parameters');
	if (params) return params.namedChildren.filter((c) => c.type !== 'comment').length;
	return node.childForFieldName('parameter') ? 1 : 0;
}

function deriveName(node: SyntaxNode): string {
	const own = node.childForFieldName('name');
	if (own) return own.text;
	const parent = node.parent;
	if (!parent) return '<anonymous>';
	switch (parent.type) {
		case 'variable_declarator':
			return parent.childForFieldName('name')?.text ?? '<anonymous>';
		case 'pair':
			return parent.childForFieldName('key')?.text ?? '<anonymous>';
		case 'assignment_expression':
			return parent.childForFieldName('left')?.text ?? '<anonymous>';
		case 'public_field_definition':
		case 'field_definition':
		case 'property_signature':
			return parent.childForFieldName('name')?.text ?? '<anonymous>';
		case 'export_statement':
			return 'default';
		case 'arguments': {
			const callee = parent.parent?.childForFieldName('function');
			if (!callee) return '(callback)';
			const firstArg = parent.namedChildren[0];
			const hint =
				firstArg && firstArg.type === 'string' && firstArg !== node
					? ` ${truncate(firstArg.text, 36)}`
					: '';
			return `(callback → ${truncate(callee.text, 32)}${hint})`;
		}
		case 'parenthesized_expression':
		case 'as_expression':
		case 'satisfies_expression':
		case 'await_expression':
			return deriveName(parent);
		case 'call_expression':
			return '(iife)';
		case 'return_statement':
			return '(returned function)';
		case 'jsx_expression':
			return '(jsx handler)';
		case 'array':
			return '(array element)';
		case 'ternary_expression':
			return '(conditional)';
		default:
			return '<anonymous>';
	}
}

function makeFunction(
	node: SyntaxNode,
	type: string,
	cls: string | null,
	exported: boolean,
	lineOffset: number
): FunctionInfo {
	const line = node.startPosition.row + lineOffset + 1;
	const endLine = node.endPosition.row + lineOffset + 1;
	let kind: FunctionKind;
	let name: string;

	if (type === 'method_definition') {
		const nameNode = node.childForFieldName('name');
		const base = nameNode?.text ?? '<method>';
		const keywords = new Set(node.children.filter((c) => !c.isNamed).map((c) => c.type));
		kind =
			base === 'constructor'
				? 'constructor'
				: keywords.has('get')
					? 'getter'
					: keywords.has('set')
						? 'setter'
						: keywords.has('*')
							? 'generator'
							: 'method';
		name = cls ? `${cls}.${base}` : base;
	} else {
		if (type === 'arrow_function') kind = 'arrow';
		else if (type.startsWith('generator')) kind = 'generator';
		else if (type === 'function_declaration') kind = 'function';
		else kind = 'expression';
		name = deriveName(node);
		const parentType = node.parent?.type;
		if (cls && (parentType === 'public_field_definition' || parentType === 'field_definition')) {
			name = `${cls}.${name}`;
		}
	}

	return {
		name: truncate(name, 80),
		kind,
		line,
		endLine,
		lines: endLine - line + 1,
		params: countParams(node),
		complexity: 1,
		async: node.children.some((c) => !c.isNamed && c.type === 'async'),
		exported
	};
}
