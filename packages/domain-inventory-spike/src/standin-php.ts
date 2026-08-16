import { execFile } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { sha256 } from '@arxic/contracts';
import {
  INTERCHANGE_SCHEMA_VERSION,
  type HttpMethod,
  type InterchangeGap,
  type InterchangeRoute,
  type RouteInventoryInterchange,
} from './interchange';

/**
 * ⚠️ STAND-IN deterministic PHP/Laravel route enumerator (issue #246, DG-02).
 *
 * This is NOT the DG-01/DG-05 language pack. It is a static routes-file scan
 * good enough to exercise the INTERCHANGE format end-to-end on real
 * repositories. It emits `standIn: true` unconditionally so no consumer can
 * mistake its output for a real pack's. Real packs are expected to enumerate
 * via tree-sitter PHP + framework wiring (DG-01) and/or Laravel's own
 * `route:list --json`, whose per-route shape this interchange extends.
 *
 * Real-world shapes handled (all observed in koel/koel@dfec91f — see
 * docs/spikes/dg-02-domain-inventory.md for citations): verb routes with
 * closure/invokable/array-controller actions; nested
 * `Route::prefix()->middleware()->group()` chains; `Route::group(['prefix' =>
 * ...])`; `Route::match(['get','post'], ...)`; optional `{param?}` segments;
 * `Route::apiResource` incl. dotted nested resources and
 * `->except()/->only()`; `->name()/->middleware()` chains; routes registered
 * inside `if (...)` blocks (flagged `conditional`); interpolated loop-driven
 * URIs (recorded as `dynamic-registration` gaps, never fakes); non-standard
 * route file names (`web.base.php`).
 */

const execute = promisify(execFile);

const STANDIN_PACK_ID = 'arxic-langpack-php-standin@0.1.0';
const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'any']);
const CONTROL_KEYWORDS = ['foreach', 'for', 'while', 'if'] as const;

export type PhpEnumerateOptions = {
  commit?: string;
  repository?: string;
  routesDir?: string;
};

export async function enumeratePhpRoutes(
  root: string,
  options: PhpEnumerateOptions = {},
): Promise<RouteInventoryInterchange> {
  const routesDir = options.routesDir ?? 'routes';
  const files = await listPhpFiles(join(root, routesDir));
  if (files.length === 0) {
    // A missing/empty routes directory is an ACCOUNTED outcome, not a silent
    // zero: the interchange must never imply "no routes" without saying why.
    const stat = await statOrNull(join(root, routesDir));
    if (!stat?.isDirectory()) {
      return {
        schemaVersion: INTERCHANGE_SCHEMA_VERSION,
        packId: STANDIN_PACK_ID,
        language: 'php',
        framework: 'laravel',
        standIn: true,
        provenance: {
          repository: options.repository ?? `file://${root}`,
          commit: options.commit ?? (await resolveCommit(root)),
        },
        routes: [],
        gaps: [
          {
            kind: 'unresolved-file',
            sourcePath: `${routesDir}/`,
            reason: `Routes directory ${routesDir}/ was not found under the repository root; the stand-in scanned nothing.`,
          },
        ],
        files: [],
      };
    }
  }
  const routes: InterchangeRoute[] = [];
  const gaps: InterchangeGap[] = [];
  const fileHashes: Array<{ path: string; sha256: string }> = [];

  for (const file of files) {
    const sourcePath = `${routesDir}/${file}`;
    let text: string;
    try {
      text = await readFile(join(root, routesDir, file), 'utf8');
    } catch (error) {
      gaps.push({
        kind: 'unresolved-file',
        sourcePath,
        reason: `File could not be read: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    fileHashes.push({ path: sourcePath, sha256: sha256(text) });
    const scanner = new RouteFileScanner(sourcePath, text, routes, gaps);
    scanner.scanBlock(0, text.length, [], false);
    // Fail-closed file accounting: a `Route::` statement that produced neither
    // a route nor a gap (broken syntax, unrecognized construct) becomes an
    // explicit parse-error gap — never a silent drop.
    if (scanner.unaccounted > 0) {
      gaps.push({
        kind: 'parse-error',
        sourcePath,
        reason: `${scanner.unaccounted} Route:: statement(s) could not be resolved by the stand-in scanner.`,
      });
    }
  }

  routes.sort(compareRoutes);
  gaps.sort((a, b) =>
    codepointCompare(
      `${a.sourcePath}\0${a.kind}\0${a.startLine ?? 0}`,
      `${b.sourcePath}\0${b.kind}\0${b.startLine ?? 0}`,
    ),
  );

  return {
    schemaVersion: INTERCHANGE_SCHEMA_VERSION,
    packId: STANDIN_PACK_ID,
    language: 'php',
    framework: 'laravel',
    standIn: true,
    provenance: {
      repository: options.repository ?? `file://${root}`,
      commit: options.commit ?? (await resolveCommit(root)),
    },
    routes,
    gaps,
    files: fileHashes,
  };
}

function compareRoutes(a: InterchangeRoute, b: InterchangeRoute): number {
  return codepointCompare(
    `${a.uri}\0${a.methods.join('|')}\0${a.sourcePath}\0${a.startLine}`,
    `${b.uri}\0${b.methods.join('|')}\0${b.sourcePath}\0${b.startLine}`,
  );
}

function codepointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function resolveCommit(root: string): Promise<string> {
  try {
    const { stdout } = await execute('git', ['rev-parse', 'HEAD'], { cwd: root });
    return stdout.trim();
  } catch {
    // Stand-in provenance is best-effort; real packs MUST carry real
    // provenance. The 40-zero sentinel keeps the interchange shape valid.
    return '0'.repeat(40);
  }
}

async function statOrNull(path: string): Promise<{ isDirectory(): boolean } | null> {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

async function listPhpFiles(dir: string): Promise<string[]> {
  const entries: string[] = [];
  try {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        for (const nested of await listPhpFiles(join(dir, entry.name))) {
          entries.push(join(entry.name, nested));
        }
      } else if (entry.name.endsWith('.php')) {
        entries.push(entry.name);
      }
    }
  } catch {
    return [];
  }
  return entries.sort((a, b) => a.localeCompare(b));
}

type ChainCall = {
  name: string;
  /** Absolute char offset of the opening paren (== arg span start). */
  argsStart: number;
  /** Absolute char offset of the closing paren (exclusive arg span end). */
  argsEnd: number;
};

class RouteFileScanner {
  readonly #path: string;
  readonly #text: string;
  readonly #routes: InterchangeRoute[];
  readonly #gaps: InterchangeGap[];
  #unaccounted = 0;

  constructor(path: string, text: string, routes: InterchangeRoute[], gaps: InterchangeGap[]) {
    this.#path = path;
    this.#text = text;
    this.#routes = routes;
    this.#gaps = gaps;
  }

  /** `Route::` statements that produced neither a route nor a gap. */
  get unaccounted(): number {
    return this.#unaccounted;
  }

  /** Scan a character range for `Route::` statements, control blocks, groups. */
  scanBlock(start: number, end: number, prefixes: string[], conditional: boolean): void {
    const text = this.#text;
    let i = start;
    while (i < end) {
      const ch = text[i];
      if (ch === "'" || ch === '"') {
        i = skipString(text, i);
        continue;
      }
      if (text.startsWith('/*', i)) {
        const close = text.indexOf('*/', i + 2);
        i = close === -1 ? end : close + 2;
        continue;
      }
      if (text.startsWith('//', i) || ch === '#') {
        const newline = text.indexOf('\n', i);
        i = newline === -1 ? end : newline + 1;
        continue;
      }
      if (text.startsWith('Route::', i) && isStatementStart(text, i)) {
        i = this.#scanStatement(i, end, prefixes, conditional);
        continue;
      }
      const keyword = controlKeywordAt(text, i);
      if (keyword) {
        i = this.#scanControlBlock(keyword, i, end, prefixes);
        continue;
      }
      i += 1;
    }
  }

  #scanStatement(routeAt: number, end: number, prefixes: string[], conditional: boolean): number {
    const text = this.#text;
    const statementEnd = findStatementEnd(text, routeAt, end);
    const chain = parseChain(text, routeAt, statementEnd);
    const head = chain[0];
    if (!head) {
      this.#unaccounted += 1;
      return statementEnd;
    }

    if (chain.some((call) => call.name === 'group')) {
      // Group statements delegate: their body is scanned recursively and every
      // nested statement accounts for itself.
      return this.#scanGroup(chain, statementEnd, prefixes, conditional);
    }

    const headStrings = this.#topLevelStrings(head);
    const uriArg = headStrings[0]?.value ?? null;
    const trailing = chain.slice(1);

    if (head.name === 'resource' || head.name === 'apiResource') {
      if (uriArg === null || uriArg.includes('$')) {
        this.#pushGap('dynamic-registration', routeAt, statementEnd, 'Interpolated resource name.');
        return statementEnd;
      }
      const modifiers = resourceModifiers(trailing, text);
      this.#expandResource(
        head.name === 'apiResource',
        uriArg,
        modifiers,
        routeAt,
        statementEnd,
        prefixes,
        conditional,
        head,
      );
      return statementEnd;
    }

    let methods: HttpMethod[] | null = null;
    let uri: string | null = uriArg;
    let uriInterpolated = headStrings[0] !== undefined && headStrings[0].value === null;
    if (head.name === 'match') {
      methods = parseMethodArray(this.#argsText(head));
      // The method tokens live in a nested array; the URI is the FIRST
      // top-level string literal.
      uri = headStrings[0]?.value ?? null;
      uriInterpolated = headStrings[0] !== undefined && headStrings[0].value === null;
    } else if (VERBS.has(head.name)) {
      methods = methodsForVerb(head.name);
    } else if (head.name === 'view' || head.name === 'redirect' || head.name === 'fallback') {
      methods = ['GET'];
    }

    if (methods === null) {
      // Unknown `Route::` construct (e.g. Route::macro) — surfaced, not hidden.
      this.#unaccounted += 1;
      return statementEnd;
    }
    if (uri === null) {
      if (uriInterpolated || this.#argsText(head).includes('$')) {
        this.#pushGap(
          'dynamic-registration',
          routeAt,
          statementEnd,
          'URI is built from runtime values (e.g. a foreach over an endpoint table); it cannot be enumerated statically without fabrication.',
        );
      } else {
        this.#unaccounted += 1;
      }
      return statementEnd;
    }
    if (uri.includes('$')) {
      this.#pushGap(
        'dynamic-registration',
        routeAt,
        statementEnd,
        'URI is built from runtime values; it cannot be enumerated statically without fabrication.',
      );
      return statementEnd;
    }

    const name = this.#topLevelStrings(trailing.find((call) => call.name === 'name'))[0]?.value;
    const middlewareCall = trailing.find((call) => call.name === 'middleware');
    const middleware = middlewareCall
      ? this.#topLevelStrings(middlewareCall)
          .map((entry) => entry.value)
          .filter((value): value is string => value !== null)
      : [];
    const action = controllerActionArg(this.#argsText(head));
    this.#pushRoute(methods, composeUri(prefixes, uri), {
      name: name ?? undefined,
      middleware: middleware.length > 0 ? middleware : undefined,
      action: action ?? undefined,
      start: routeAt,
      end: statementEnd,
      conditional,
    });
    return statementEnd;
  }

  #scanGroup(
    chain: ChainCall[],
    statementEnd: number,
    prefixes: string[],
    conditional: boolean,
  ): number {
    const text = this.#text;
    const prefixCall = chain.find((call) => call.name === 'prefix');
    const groupCall = chain.find((call) => call.name === 'group');
    if (!groupCall) return statementEnd;
    let prefix: string | null = null;
    if (prefixCall) {
      prefix = firstStringInSpan(text, prefixCall.argsStart, prefixCall.argsEnd);
    } else {
      // Route::group(['prefix' => 'x'], ...) — the array is the FIRST
      // top-level argument. NEVER scan the whole arg span: it contains the
      // closure body, where NESTED groups legitimately declare their own
      // prefixes (observed in koel: auth group → nested radio group).
      prefix = arrayPrefixInSpan(firstTopLevelArgument(this.#argsText(groupCall)));
    }

    const closure = findClosureBody(text, groupCall.argsStart, groupCall.argsEnd);
    if (closure === null) {
      this.#pushGap(
        'unresolved-file',
        groupCall.argsStart,
        groupCall.argsEnd,
        'Route::group includes a file instead of a closure; the stand-in does not follow file includes.',
      );
      return statementEnd;
    }
    const nested = [...prefixes, ...(prefix !== null ? [prefix] : [])];
    this.scanBlock(closure.bodyStart, closure.bodyEnd, nested, conditional);
    return statementEnd;
  }

  #scanControlBlock(keyword: string, at: number, end: number, prefixes: string[]): number {
    const text = this.#text;
    let i = at + keyword.length;
    while (i < end && text[i] !== '(' && text[i] !== '{' && text[i] !== ';') i += 1;
    if (text[i] === '(') {
      const close = matchParen(text, i, end);
      i = close === -1 ? end : close + 1;
    }
    while (i < end && /\s/u.test(text[i]!)) i += 1;
    if (text[i] !== '{') return Math.max(i, at + keyword.length);
    const bodyClose = matchBrace(text, i, end);
    if (bodyClose === -1) return end;
    // `if`/`foreach`/`for`/`while` bodies are runtime-conditioned: routes
    // inside are flagged conditional rather than presented as unconditional.
    this.scanBlock(i + 1, bodyClose, prefixes, true);
    return bodyClose + 1;
  }

  #expandResource(
    apiOnly: boolean,
    resourceName: string,
    modifiers: { except: Set<string>; only: Set<string> | null },
    start: number,
    end: number,
    prefixes: string[],
    conditional: boolean,
    head: ChainCall,
  ): void {
    const dotted = resourceName.split('.');
    const collection = dotted
      .map((piece, index) =>
        index === dotted.length - 1 ? piece : `${piece}/{${singularize(piece)}}`,
      )
      .join('/');
    const lastPiece = dotted[dotted.length - 1]!;
    const member = `${collection}/{${singularize(lastPiece)}}`;
    const actions: Array<{ action: string; method: HttpMethod; uri: string }> = [
      { action: 'index', method: 'GET', uri: collection },
      { action: 'store', method: 'POST', uri: collection },
      { action: 'show', method: 'GET', uri: member },
      { action: 'update', method: 'PUT', uri: member },
      { action: 'destroy', method: 'DELETE', uri: member },
    ];
    if (!apiOnly) {
      actions.push(
        { action: 'create', method: 'GET', uri: `${collection}/create` },
        { action: 'edit', method: 'GET', uri: `${member}/edit` },
      );
    }
    const controller = controllerActionArg(this.#argsText(head));
    for (const entry of actions) {
      if (modifiers.except.has(entry.action)) continue;
      if (modifiers.only !== null && !modifiers.only.has(entry.action)) continue;
      this.#pushRoute([entry.method], composeUri(prefixes, entry.uri), {
        name: `${resourceName}.${entry.action}`,
        action:
          controller === null
            ? undefined
            : `${controller}${controller.includes('@') ? '' : '@'}${entry.action}`,
        start,
        end,
        conditional,
      });
    }
  }

  #argsText(call: ChainCall): string {
    return this.#text.slice(call.argsStart + 1, call.argsEnd);
  }

  /**
   * String literals at the TOP LEVEL of a call's argument list (not inside
   * nested arrays/parens — so `Route::match(['get','post'], 'uri')` yields the
   * URI but not the method tokens). PHP semantics: single-quoted strings are
   * literal; double-quoted strings containing `$` are runtime interpolation
   * and yield `null` (the stand-in never fabricates their value).
   */
  #topLevelStrings(call: ChainCall | undefined): Array<{ value: string | null }> {
    if (!call) return [];
    const text = this.#text;
    const out: Array<{ value: string | null }> = [];
    let depth = 0;
    let i = call.argsStart + 1;
    const end = call.argsEnd;
    while (i < end) {
      const ch = text[i];
      if (ch === "'" || ch === '"') {
        if (depth === 0) {
          const close = text.indexOf(ch, i + 1);
          if (close === -1 || close >= end) return out;
          const raw = text.slice(i + 1, close);
          out.push({ value: ch === "'" ? raw : raw.includes('$') ? null : raw });
          i = close + 1;
          continue;
        }
        const close = text.indexOf(ch, i + 1);
        if (close === -1) return out;
        i = close + 1;
        continue;
      }
      if (ch === '(' || ch === '[' || ch === '{') depth += 1;
      if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
      i += 1;
    }
    return out;
  }

  #pushRoute(
    methods: HttpMethod[],
    uri: string,
    details: {
      name?: string;
      action?: string;
      middleware?: string[];
      start: number;
      end: number;
      conditional: boolean;
    },
  ): void {
    const startLine = lineOf(this.#text, details.start);
    const endLine = lineOf(this.#text, Math.max(details.start, details.end - 1));
    this.#routes.push({
      methods,
      ...(details.name !== undefined ? { name: details.name } : {}),
      ...(details.action !== undefined ? { action: details.action } : {}),
      ...(details.middleware !== undefined ? { middleware: details.middleware } : {}),
      uri,
      sourcePath: this.#path,
      startLine: Math.min(startLine, endLine),
      endLine: Math.max(startLine, endLine),
      ...(details.conditional ? { conditional: true } : {}),
    });
  }

  #pushGap(kind: InterchangeGap['kind'], start: number, end: number, reason: string): void {
    const startLine = lineOf(this.#text, start);
    const endLine = lineOf(this.#text, Math.max(start, end - 1));
    this.#gaps.push({
      kind,
      sourcePath: this.#path,
      startLine: Math.min(startLine, endLine),
      endLine: Math.max(startLine, endLine),
      reason,
    });
  }
}

/** Skip a comment (// ... \n, # ... \n, or block) starting at `at`; returns next index. */
function skipComment(text: string, at: number): number {
  if (text.startsWith('//', at) || text[at] === '#') {
    const newline = text.indexOf('\n', at);
    return newline === -1 ? text.length : newline + 1;
  }
  if (text.startsWith('/*', at)) {
    const close = text.indexOf('*/', at + 2);
    return close === -1 ? text.length : close + 2;
  }
  return at;
}

function isStatementStart(text: string, at: number): boolean {
  const before = text[at - 1];
  return before === undefined || /[\s({=,;.]/u.test(before);
}

function skipString(text: string, at: number): number {
  const quote = text[at]!;
  let i = at + 1;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === quote) return i + 1;
    i += 1;
  }
  return text.length;
}

function findStatementEnd(text: string, from: number, limit: number): number {
  let depth = 0;
  let i = from;
  while (i < limit) {
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      i = skipString(text, i);
      continue;
    }
    if (ch === '/' || ch === '#') {
      const next = skipComment(text, i);
      if (next !== i) {
        i = next;
        continue;
      }
    }
    if (ch === '(' || ch === '{' || ch === '[') depth += 1;
    if (ch === ')' || ch === '}' || ch === ']') depth -= 1;
    if (ch === ';' && depth <= 0) return i + 1;
    i += 1;
  }
  return limit;
}

function parseChain(text: string, from: number, statementEnd: number): ChainCall[] {
  const calls: ChainCall[] = [];
  let i = text.indexOf('::', from);
  if (i === -1 || i >= statementEnd) return calls;
  i += 2;

  const readCall = (): void => {
    while (i < statementEnd && !/[A-Za-z_]/u.test(text[i]!)) i += 1;
    let name = '';
    while (i < statementEnd && /[A-Za-z_0-9]/u.test(text[i]!)) {
      name += text[i]!;
      i += 1;
    }
    if (!name) return;
    while (i < statementEnd && /\s/u.test(text[i]!)) i += 1;
    if (text[i] !== '(') {
      calls.push({ name, argsStart: i, argsEnd: i });
      return;
    }
    const close = matchParen(text, i, statementEnd + depthSlack(text, i, statementEnd));
    if (close === -1) {
      calls.push({ name, argsStart: i, argsEnd: i });
      return;
    }
    calls.push({ name, argsStart: i, argsEnd: close });
    i = close + 1;
  };

  readCall();
  while (i < statementEnd) {
    while (i < statementEnd && (/\s/u.test(text[i]!) || text[i] === '.')) i += 1;
    if (text.startsWith('->', i)) {
      i += 2;
      readCall();
      continue;
    }
    if (text[i] === ';') break;
    i += 1;
  }
  return calls;
}

/** Group statements legitimately extend past `;` inside closure bodies. */
function depthSlack(text: string, open: number, limit: number): number {
  // The statement end finder already balanced braces, so the group's real
  // closing paren may sit past nested `;`. Look ahead generously but bounded.
  const window = text.indexOf(';', Math.max(open, limit));
  return window === -1 ? 50_000 : window - limit + 1;
}

function matchParen(text: string, open: number, limit: number): number {
  let depth = 0;
  for (let i = open; i < limit; i += 1) {
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      i = skipString(text, i) - 1;
      continue;
    }
    if (ch === '/' || ch === '#') {
      const next = skipComment(text, i);
      if (next !== i) {
        i = next - 1;
        continue;
      }
    }
    if (ch === '(' || ch === '{' || ch === '[') depth += 1;
    if (ch === ')' || ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0 && ch === ')') return i;
    }
  }
  return -1;
}

function matchBrace(text: string, open: number, limit: number): number {
  let depth = 0;
  for (let i = open; i < limit; i += 1) {
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      i = skipString(text, i) - 1;
      continue;
    }
    if (ch === '/' || ch === '#') {
      const next = skipComment(text, i);
      if (next !== i) {
        i = next - 1;
        continue;
      }
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function controlKeywordAt(text: string, at: number): string | null {
  for (const keyword of CONTROL_KEYWORDS) {
    if (text.startsWith(keyword, at)) {
      const before = text[at - 1];
      const after = text[at + keyword.length];
      if (
        (before === undefined || /[\s{}();]/u.test(before)) &&
        after !== undefined &&
        /[\s(]/u.test(after)
      ) {
        return keyword;
      }
    }
  }
  return null;
}

function firstStringInSpan(text: string, start: number, end: number): string | null {
  for (let i = start; i < end; i += 1) {
    const ch = text[i];
    if (ch === "'") {
      const close = text.indexOf("'", i + 1);
      if (close === -1 || close >= end) return null;
      return text.slice(i + 1, close);
    }
    if (ch === '"') {
      const close = text.indexOf('"', i + 1);
      if (close === -1 || close >= end) return null;
      const raw = text.slice(i + 1, close);
      return raw.includes('$') ? null : raw;
    }
  }
  return null;
}

function arrayPrefixInSpan(argsText: string): string | null {
  const match = /['"]prefix['"]\s*=>\s*['"]([^'"]+)['"]/u.exec(argsText);
  return match ? match[1]! : null;
}

/**
 * The leading (pre-closure) arguments of a group call. A prefix array always
 * precedes the closure in real code (`Route::group(['prefix' => 'x'], static
 * function ...)`); everything from the closure onward is body, where NESTED
 * groups legitimately declare their own prefixes (observed in koel: an auth
 * group containing a radio group). Scanning the whole arg span would leak the
 * nested prefix upward, so the span is cut at the first depth-0 comma and at a
 * closure-only argument.
 */
function firstTopLevelArgument(argsText: string): string {
  let depth = 0;
  for (let i = 0; i < argsText.length; i += 1) {
    const ch = argsText[i];
    if (ch === "'" || ch === '"') {
      const close = argsText.indexOf(ch, i + 1);
      if (close === -1) return argsText;
      i = close;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    if (ch === ',' && depth === 0) return argsText.slice(0, i);
  }
  const trimmed = argsText.replace(/^\s*(?:static\s+)?/u, '');
  if (trimmed.startsWith('function') || trimmed.startsWith('fn')) return '';
  return argsText;
}

function parseMethodArray(argsText: string): HttpMethod[] | null {
  const arrayMatch = /\[[^\]]*\]/u.exec(argsText.replace(/\s+/gu, ' '));
  if (!arrayMatch) return null;
  const methods = [...arrayMatch[0].matchAll(/['"]([a-z]+)['"]/gu)].map((m) => m[1]!.toUpperCase());
  if (methods.length === 0) return null;
  const valid = methods.every((m) =>
    ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(m),
  );
  return valid ? (methods as HttpMethod[]) : null;
}

function stringArgsOf(argsText: string): string[] {
  return [...argsText.matchAll(/['"]([^'"]+)['"]/gu)].map((m) => m[1]!);
}

function controllerActionArg(argsText: string): string | null {
  const arrayForm = /\[\s*([A-Za-z_\\][\w\\]*)\s*,\s*'([^']+)'\s*\]/u.exec(argsText);
  if (arrayForm) return `${arrayForm[1]}@${arrayForm[2]}`;
  const invokable = /([A-Za-z_\\][\w\\]*)::class/u.exec(argsText);
  if (invokable) return invokable[1]!;
  if (/(?:static\s+)?(?:fn|function)\s*\(/u.test(argsText)) return 'Closure';
  return null;
}

function resourceModifiers(
  trailing: ChainCall[],
  text: string,
): {
  except: Set<string>;
  only: Set<string> | null;
} {
  const except = new Set<string>();
  let only: Set<string> | null = null;
  for (const call of trailing) {
    const args = text.slice(call.argsStart + 1, call.argsEnd);
    if (call.name === 'except') {
      for (const action of stringArgsOf(args)) except.add(action);
    } else if (call.name === 'only') {
      only = new Set(stringArgsOf(args));
    }
  }
  return { except, only };
}

function findClosureBody(
  text: string,
  start: number,
  end: number,
): { bodyStart: number; bodyEnd: number } | null {
  for (let i = start; i < end; i += 1) {
    if (text.startsWith('function', i) && /[\s(]/u.test(text[i + 8] ?? ' ')) {
      let j = i + 8;
      let depth = 0;
      while (j < end) {
        const ch = text[j];
        if (ch === "'" || ch === '"') {
          j = skipString(text, j);
          continue;
        }
        if (ch === '(' || ch === '[') depth += 1;
        if (ch === ')' || ch === ']') depth -= 1;
        if (ch === '{' && depth <= 0) {
          const close = matchBrace(text, j, end);
          if (close === -1) return null;
          return { bodyStart: j + 1, bodyEnd: close };
        }
        j += 1;
      }
      return null;
    }
  }
  return null;
}

function methodsForVerb(verb: string): HttpMethod[] | null {
  switch (verb) {
    case 'get':
      return ['GET'];
    case 'post':
      return ['POST'];
    case 'put':
      return ['PUT'];
    case 'patch':
      return ['PATCH'];
    case 'delete':
      return ['DELETE'];
    case 'options':
      return ['OPTIONS'];
    case 'head':
      return ['HEAD'];
    case 'any':
      return ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
    default:
      return null;
  }
}

function composeUri(prefixes: string[], uri: string): string {
  const pieces = [...prefixes, uri]
    .flatMap((piece) => piece.replace(/^\/+|\/+$/gu, ''))
    .filter((piece) => piece !== '');
  const joined = `/${pieces.join('/')}`;
  return joined === '/' ? '/' : joined;
}

function singularize(word: string): string {
  const irregulars: Record<string, string> = {
    people: 'person',
    children: 'child',
    men: 'man',
    women: 'woman',
  };
  if (irregulars[word]) return irregulars[word]!;
  if (word.endsWith('ies') && word.length > 3) return `${word.slice(0, -3)}y`;
  if (/(?:ses|xes|zes)$/u.test(word) && word.length > 3) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 1) return word.slice(0, -1);
  return word;
}

function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}
