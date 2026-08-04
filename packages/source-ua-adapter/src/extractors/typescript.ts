import type { SyntaxNode } from '../parser';

export type SourceFinding = {
  kind: 'symbol' | 'import' | 'call';
  value: string;
  startLine: number;
  endLine: number;
};

function range(node: SyntaxNode) {
  return { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 };
}

function declarationName(node: SyntaxNode): string | null {
  return node.childForFieldName('name')?.text ?? null;
}

export function extractTypeScript(root: SyntaxNode): SourceFinding[] {
  const findings: SourceFinding[] = [];
  const visit = (node: SyntaxNode) => {
    if (node.type === 'function_declaration' || node.type === 'class_declaration') {
      const name = declarationName(node);
      if (name) findings.push({ kind: 'symbol', value: name, ...range(node) });
    } else if (node.type === 'variable_declarator') {
      const value = node.childForFieldName('value');
      const name = declarationName(node);
      if (name && value && ['arrow_function', 'function_expression'].includes(value.type)) {
        findings.push({ kind: 'symbol', value: name, ...range(node) });
      }
    } else if (node.type === 'import_statement') {
      const source = node.namedChildren.find((child) => child.type === 'string');
      if (source) findings.push({ kind: 'import', value: unquote(source.text), ...range(node) });
    } else if (node.type === 'call_expression') {
      const callee = node.childForFieldName('function');
      if (callee) findings.push({ kind: 'call', value: callee.text, ...range(node) });
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(root);
  return findings;
}

export function unquote(value: string): string {
  return value.length >= 2 ? value.slice(1, -1) : value;
}
