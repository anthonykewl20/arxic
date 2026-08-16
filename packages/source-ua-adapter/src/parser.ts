import { createRequire } from 'node:module';
import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import TypeScript from 'tree-sitter-typescript';
import type { SupportedSourceLanguage } from './policy';

export type SyntaxNode = Parser.SyntaxNode;

export type ParsedSource = {
  root: SyntaxNode;
  hasError: boolean;
  dispose: () => void;
};

export class GrammarUnavailableError extends Error {
  constructor(packageName: string) {
    super(`grammar package ${packageName} is unavailable in this runtime`);
    this.name = 'GrammarUnavailableError';
  }
}

// The PHP grammar is loaded lazily via createRequire (not a static import) so
// esbuild-bundled runtimes that do not declare it external (the worker bundle
// today) still boot for every other language; a PHP parse in such a runtime
// fails loudly with GrammarUnavailableError, which the scanner surfaces as a
// blocked diagnostic — never a silent gap. DG-05 wires the worker packaging.
const require = createRequire(import.meta.url);
let phpGrammar: typeof JavaScript | null | undefined;

function loadPhpGrammar(): typeof JavaScript | null {
  if (phpGrammar !== undefined) return phpGrammar;
  try {
    const mod = require('tree-sitter-php') as { php?: unknown };
    phpGrammar = (mod.php as typeof JavaScript | undefined) ?? null;
  } catch {
    phpGrammar = null;
  }
  return phpGrammar;
}

export class SourceParser {
  private readonly parsers = new Map<string, Parser>();

  parse(path: string, language: SupportedSourceLanguage, source: string): ParsedSource {
    const grammarKey = path.endsWith('.tsx') ? 'tsx' : language;
    let parser = this.parsers.get(grammarKey);
    if (!parser) {
      parser = new Parser();
      let grammar = JavaScript;
      if (grammarKey === 'tsx') grammar = TypeScript.tsx;
      else if (language === 'typescript') grammar = TypeScript.typescript;
      else if (language === 'php') {
        const php = loadPhpGrammar();
        if (!php) throw new GrammarUnavailableError('tree-sitter-php');
        grammar = php;
      }
      parser.setLanguage(grammar as unknown as Parser.Language);
      this.parsers.set(grammarKey, parser);
    }
    const tree = parser.parse(source);
    return {
      root: tree.rootNode,
      hasError: tree.rootNode.hasError,
      dispose: () => {
        const disposable = tree as unknown as { delete?: () => void };
        disposable.delete?.();
      },
    };
  }
}
