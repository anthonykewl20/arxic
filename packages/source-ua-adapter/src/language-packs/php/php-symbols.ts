// PHP structural extraction over the tree-sitter-php surface.
//
// Adapted (not vendored) from upstream Understand-Anything
// php-extractor.ts @ main (commit 32944829e7a63a9fa9c55d811d7f98a9530c6a6a),
// MIT — the node-type mapping decisions below mirror its documented mapping:
//   - function_definition           → functions array (upstream L149-155)
//   - class_declaration/interface_declaration → classes (upstream L157-171)
//   - method_declaration            → methods + functions (upstream L373-389)
//   - namespace_use_declaration     → imports incl. grouped/aliased (upstream L418-460)
//   - call expressions              → calls (upstream extractCallGraph L191-267)
// Arxic maps these onto its SourceFinding shape instead of upstream's
// StructuralAnalysis, and omits the call-graph entry type (no consumer here).

import type { SourceFinding } from '../../extractors/typescript';
import type { SyntaxNode } from '../../parser';

export function extractPhp(root: SyntaxNode): SourceFinding[] {
  const findings: SourceFinding[] = [];
  const visit = (node: SyntaxNode): void => {
    switch (node.type) {
      case 'function_definition':
      case 'class_declaration':
      case 'interface_declaration':
      case 'trait_declaration':
      case 'enum_declaration': {
        const name = node.childForFieldName('name');
        if (name) {
          findings.push({
            kind: 'symbol',
            value: name.text,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
          });
        }
        break;
      }
      case 'method_declaration': {
        const name = node.childForFieldName('name');
        if (name) {
          findings.push({
            kind: 'symbol',
            value: name.text,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
          });
        }
        break;
      }
      case 'namespace_use_declaration': {
        findings.push(...useFindings(node));
        break;
      }
      case 'function_call_expression':
      case 'member_call_expression':
      case 'scoped_call_expression': {
        const name = node.childForFieldName('name');
        if (name) {
          findings.push({
            kind: 'call',
            value: name.text,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
          });
        }
        break;
      }
      default:
        break;
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(root);
  return findings;
}

function useFindings(node: SyntaxNode): SourceFinding[] {
  const findings: SourceFinding[] = [];
  const startLine = node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;
  const group = node.namedChildren.find((child) => child.type === 'namespace_use_group');
  if (group) {
    const prefix = node.namedChildren.find((child) => child.type === 'namespace_name')?.text;
    for (const clause of group.namedChildren) {
      if (clause.type !== 'namespace_use_clause') continue;
      const name = clause.namedChildren.find(
        (child) => child.type === 'name' || child.type === 'qualified_name',
      );
      if (name) {
        findings.push({
          kind: 'import',
          value: prefix ? `${prefix}\\${name.text}` : name.text,
          startLine,
          endLine,
        });
      }
    }
    return findings;
  }
  for (const clause of node.namedChildren) {
    if (clause.type !== 'namespace_use_clause') continue;
    const qualified = clause.namedChildren.find((child) => child.type === 'qualified_name');
    if (qualified) {
      findings.push({
        kind: 'import',
        value: qualified.text.replace(/^\\/u, ''),
        startLine,
        endLine,
      });
    }
  }
  return findings;
}
