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
      parser.setLanguage(grammar as Parser.Language);
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
