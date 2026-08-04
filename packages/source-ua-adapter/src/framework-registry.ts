import type { SyntaxNode } from './parser';
import { unquote } from './extractors/typescript';

export type RouteFinding = {
  kind: 'route';
  value: string;
  startLine: number;
  endLine: number;
  extractor: 'nextjs' | 'express';
};

export function extractFrameworkRoutes(path: string, root: SyntaxNode): RouteFinding[] {
  const routes: RouteFinding[] = [];
  const next = nextRoute(path, root);
  if (next) routes.push(next);

  const visit = (node: SyntaxNode) => {
    if (node.type === 'call_expression') {
      const callee = node.childForFieldName('function');
      const match = callee?.text.match(/^(?:app|router)\.(get|post|put|delete|patch)$/u);
      const argument = node.childForFieldName('arguments')?.namedChildren[0];
      if (match?.[1] && argument?.type === 'string') {
        routes.push({
          kind: 'route',
          value: `${match[1].toUpperCase()} ${unquote(argument.text)}`,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          extractor: 'express',
        });
      }
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(root);
  return routes;
}

function nextRoute(path: string, root: SyntaxNode): RouteFinding | null {
  const match = path.match(/(?:^|\/)app\/(.*\/)?page\.(?:tsx?|jsx?)$/u);
  if (!match) return null;
  const segments = (match[1] ?? '')
    .replace(/\/$/u, '')
    .split('/')
    .filter((segment) => segment && !/^\(.+\)$/u.test(segment));
  const route = `/${segments.join('/')}`;
  return {
    kind: 'route',
    value: `GET ${route === '/' ? '/' : route}`,
    startLine: 1,
    endLine: Math.max(1, root.endPosition.row + (root.endPosition.column > 0 ? 1 : 0)),
    extractor: 'nextjs',
  };
}
