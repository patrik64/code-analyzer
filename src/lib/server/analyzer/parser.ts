import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import TypeScript from 'tree-sitter-typescript';
import type { Language } from '#lib/types.js';

export type Grammar = 'javascript' | 'typescript' | 'tsx';
export type SyntaxNode = Parser.SyntaxNode;
export type Tree = Parser.Tree;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const grammars: Record<Grammar, any> = {
	javascript: JavaScript,
	typescript: TypeScript.typescript,
	tsx: TypeScript.tsx
};

const parsers = new Map<Grammar, Parser>();

export function getParser(grammar: Grammar): Parser {
	let parser = parsers.get(grammar);
	if (!parser) {
		parser = new Parser();
		parser.setLanguage(grammars[grammar]);
		parsers.set(grammar, parser);
	}
	return parser;
}

/** Pick the tree-sitter grammar for a file language (and, for components, the script `lang`). */
export function grammarFor(language: Language, scriptLang?: string | null): Grammar {
	switch (language) {
		case 'ts':
			return 'typescript';
		case 'tsx':
			return 'tsx';
		case 'js':
		case 'jsx':
			return 'javascript';
		case 'svelte':
		case 'vue':
			return scriptLang && /^(ts|typescript)$/i.test(scriptLang) ? 'typescript' : 'javascript';
		default:
			return 'javascript';
	}
}

/**
 * Parse source text. node-tree-sitter copies string input through a fixed buffer and throws
 * `Invalid argument` when the text is larger than that buffer, so size it from the input.
 */
export function parseSource(text: string, grammar: Grammar): Tree {
	const parser = getParser(grammar);
	return parser.parse(text, undefined, {
		bufferSize: Math.max(64 * 1024, text.length * 2 + 1024)
	});
}
