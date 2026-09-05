import { fileURLToPath } from 'node:url';
import { realpath } from 'node:fs/promises';
import { sha256 } from '@arxic/contracts';
import { readSafeSource } from './safe-source';
import type { NormalizedSourceIndex } from './normalize';
import { SourceParser, type SyntaxNode } from './parser';
import { bytewiseCompare } from './git';

export type FrontendKind =
  | 'component'
  | 'control'
  | 'condition'
  | 'state'
  | 'action'
  | 'requirement'
  | 'test'
  | 'feature-flag';
export type FrontendRow = {
  id: string;
  kind: FrontendKind;
  label: string;
  truthState: 'hypothesized';
  basis: 'syntax' | 'declaration';
  source: { path: string; startLine: number; endLine: number; blobSha256: string; commit: string };
};
export type FrontendInventory = {
  schemaVersion: 'arxic-frontend-inventory-v1';
  revision: NormalizedSourceIndex['revision'];
  rows: FrontendRow[];
  gaps: Array<{ path: string; reason: string }>;
  files: Array<{ path: string; status: 'inventoried' | 'gap'; rows: number }>;
  coverage: {
    complete: false;
    enumeratedFiles: number;
    analyzedFiles: number;
    rowLimit: number;
    fileLimit: number;
    unobservedDimensions: string[];
  };
};

/** Additive source capability: never upgrades static evidence into runtime truth. */
export async function collectFrontendInventory(
  root: string,
  index: NormalizedSourceIndex,
): Promise<FrontendInventory> {
  const resolved = await realpath(root);
  if (resolved !== (await realpath(fileURLToPath(index.revision.repository))))
    throw new Error('Frontend inventory source does not match the indexed repository');
  const rows: FrontendRow[] = [];
  const gaps: FrontendInventory['gaps'] = [];
  const files: FrontendInventory['files'] = [];
  const parser = new SourceParser();
  const rowLimit = 20_000;
  const fileLimit = 5_000;
  let analyzedFiles = 0;
  for (const file of [...index.manifest].sort((a, b) => bytewiseCompare(a.path, b.path))) {
    const start = rows.length;
    const gapsBefore = gaps.length;
    const gap = (reason: string) => gaps.push({ path: file.path, reason });
    const docs = /\.(?:md|mdx|txt)$/iu.test(file.path);
    const code = ['typescript', 'javascript'].includes(file.language);
    if (!index.revision.commit) gap('missing-revision');
    else if (file.reason && file.reason !== 'unsupported-language') gap(file.reason);
    else if (!code && !docs)
      gap(
        /\.(?:vue|svelte|ejs|html|hbs|blade\.php)$/iu.test(file.path)
          ? 'unsupported-framework'
          : 'unsupported-file-kind',
      );
    else if (analyzedFiles >= fileLimit || rows.length >= rowLimit) gap('inventory-budget');
    else {
      const read = await readSafeSource(resolved, file.path, 1024 * 1024);
      if (!read.ok) gap(read.kind === 'oversize' ? 'oversize' : 'unsafe-file');
      else if (sha256(read.bytes) !== file.blobSha256) gap('source-changed');
      else {
        analyzedFiles++;
        const text = read.bytes.toString('utf8');
        let bounded = false;
        const add = (
          kind: FrontendKind,
          label: string,
          startLine: number,
          endLine: number,
          basis: FrontendRow['basis'] = 'syntax',
        ) => {
          if (rows.length >= rowLimit) {
            bounded = true;
            return;
          }
          const source = {
            path: file.path,
            startLine,
            endLine,
            blobSha256: file.blobSha256,
            commit: index.revision.commit!,
          };
          const short = label.replace(/\s+/gu, ' ').trim().slice(0, 200);
          rows.push({
            id: sha256(JSON.stringify([source, kind, short])),
            kind,
            label: short,
            truthState: 'hypothesized',
            basis,
            source,
          });
        };
        if (docs) {
          const lines = text.split('\n');
          let fence: string | null = null;
          for (let i = 0; i < lines.length; i++) {
            const marker = /^\s*(`{3,}|~{3,})/u.exec(lines[i]);
            if (marker) {
              fence = fence === marker[1][0] ? null : marker[1][0];
              continue;
            }
            if (fence) continue;
            if (
              /^\s{0,3}#{1,6}\s+\S|\b(?:must|shall|should|required|acceptance)\b/iu.test(lines[i])
            )
              add('requirement', lines[i], i + 1, i + 1, 'declaration');
          }
          gap('documentation-declarations-not-acceptance-proof');
          if (file.path.endsWith('.mdx')) gap('mdx-components-not-parsed');
        } else {
          const parsed = parser.parse(
            file.path,
            file.language as 'typescript' | 'javascript',
            text,
          );
          try {
            if (parsed.hasError) gap('parse-error');
            else extractFrontend(parsed.root, add);
          } finally {
            parsed.dispose();
          }
        }
        if (bounded) gap('inventory-budget');
      }
    }
    files.push({
      path: file.path,
      status: gaps.length > gapsBefore ? 'gap' : 'inventoried',
      rows: rows.length - start,
    });
  }
  return {
    schemaVersion: 'arxic-frontend-inventory-v1',
    revision: index.revision,
    rows,
    gaps,
    files,
    coverage: {
      complete: false,
      enumeratedFiles: index.manifest.length,
      analyzedFiles,
      rowLimit,
      fileLimit,
      unobservedDimensions: [
        'persona',
        'feature-flag-value',
        'runtime-route',
        'runtime-state',
        'action-result',
        'viewport',
      ],
    },
  };
}

function extractFrontend(
  root: SyntaxNode,
  add: (
    kind: FrontendKind,
    label: string,
    start: number,
    end: number,
    basis?: FrontendRow['basis'],
  ) => void,
) {
  // An explicit stack bounds JS call-stack use for deeply nested generated input.
  const stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    const emit = (kind: FrontendKind, label: string, basis?: FrontendRow['basis']) =>
      add(kind, label, node.startPosition.row + 1, node.endPosition.row + 1, basis);
    const named = (name: string) => node.childForFieldName(name)?.text;
    if (['jsx_opening_element', 'jsx_self_closing_element'].includes(node.type)) {
      const tag = named('name') ?? 'fragment';
      if (/^[A-Z]/u.test(tag)) emit('component', tag);
      if (
        [
          'button',
          'input',
          'textarea',
          'select',
          'a',
          'form',
          'dialog',
          'details',
          'summary',
        ].includes(tag)
      ) {
        const attributes = node.namedChildren.filter((child) => child.type === 'jsx_attribute');
        const names = attributes
          .map((attribute) => attribute.namedChildren[0]?.text)
          .filter(Boolean);
        emit('control', `${tag}${names.length ? ` (${names.join(', ')})` : ''}`);
      }
    }
    if (node.type === 'jsx_attribute') {
      const name = node.namedChildren[0]?.text ?? '';
      if (/^on[A-Z]|^(?:action|formAction)$/u.test(name)) emit('action', name);
      if (['disabled', 'hidden', 'aria-expanded', 'aria-busy', 'aria-invalid'].includes(name))
        emit('state', name);
    }
    if (['function_declaration', 'class_declaration', 'variable_declarator'].includes(node.type)) {
      const name = named('name');
      if (
        name &&
        /^[A-Z][A-Za-z0-9_$]*$/u.test(name) &&
        node.descendantsOfType(['jsx_element', 'jsx_self_closing_element']).length
      )
        emit('component', name);
    }
    if (['if_statement', 'ternary_expression', 'switch_statement'].includes(node.type))
      emit('condition', `${node.type.replaceAll('_', ' ')} (source condition)`);
    if (node.type === 'binary_expression' && ['&&', '||', '??'].includes(named('operator') ?? ''))
      emit('condition', `conditional expression ${named('operator')}`);
    if (node.type === 'call_expression') {
      const callee = named('function') ?? '';
      if (/^(?:React\.)?use(?:State|Reducer|Effect|Context|SyncExternalStore)$/u.test(callee))
        emit('state', callee);
      if (
        /^(?:it|test|describe)(?:\.(?:only|skip|todo|each|serial|parallel|concurrent))*$/u.test(
          callee,
        )
      ) {
        const title = node.childForFieldName('arguments')?.namedChildren[0];
        if (title?.type === 'string') emit('test', title.text.slice(1, -1), 'declaration');
        else emit('test', `${callee} (dynamic declaration)`, 'declaration');
      }
    }
    if (
      node.type === 'member_expression' &&
      /^(?:process\.env\.|import\.meta\.env\.|flags\.|featureFlags\.)/u.test(node.text)
    )
      emit('feature-flag', node.text);
    for (let i = node.namedChildren.length - 1; i >= 0; i--) stack.push(node.namedChildren[i]);
  }
}
