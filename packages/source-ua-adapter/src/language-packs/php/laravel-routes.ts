// Deterministic Laravel route inventory over the tree-sitter-php surface.
//
// This is the Arxic-owned layer ADR-008 Decision 5 calls for: upstream
// Understand-Anything provides the language surface (grammar + structural
// extraction); it has no per-framework route inventory (verified at source
// level: its frameworks/ registry ships django/express/fastapi/flask/gin/
// nextjs/rails/react/spring/vue — no laravel). Every rule below cites the
// Laravel reference implementation it reproduces (laravel/framework v13.24.0,
// the exact version koel's composer.lock pins).
//
// Design invariants (ADR-008 Decision 2 — never silently omit):
//   - a route that cannot be statically resolved (interpolation, unresolvable
//     loop) emits ARXIC-SOURCE-ROUTE-DYNAMIC-REGISTRATION;
//   - a route whose handler cannot be grounded emits
//     ARXIC-SOURCE-HANDLER-UNRESOLVED while the route row is still emitted.

import type { Diagnostic } from '@arxic/contracts';
import {
  ARXIC_SOURCE_HANDLER_UNRESOLVED,
  ARXIC_SOURCE_ROUTE_DYNAMIC_REGISTRATION,
  ARXIC_SOURCE_ROUTE_FILE_INCLUDE,
  ARXIC_SOURCE_ROUTE_UNSUPPORTED_CONSTRUCT,
} from '../../diagnostics';
import type { ParsedSource, SyntaxNode } from '../../parser';
import { SourceParser } from '../../parser';
import { expandResource, type ResourceAction } from './laravel-resources';

export type RepoFileRead = { ok: true; text: string } | { ok: false; reason: string };

export type RepoFileAccess = {
  readRelative(path: string): Promise<RepoFileRead>;
};

export type LaravelRouteRow = {
  method: string;
  uri: string;
  name?: string;
  controller?: string;
  action?: string;
  kind: 'static' | 'loop-resolved';
  sourcePath: string;
  /** Route is registered inside a runtime-evaluated if/elseif/else block. */
  conditional?: boolean;
  /** Group + per-route middleware in declaration order (route:list parity). */
  middleware?: string[];
  startLine: number;
  endLine: number;
};

/** Gap kinds mirror DG-02's RouteInventoryInterchange gap vocabulary 1:1. */
export type LaravelGapKind =
  'dynamic-registration' | 'parse-error' | 'unresolved-file' | 'conditional-block' | 'unsupported';

export type LaravelGap = {
  kind: LaravelGapKind;
  sourcePath: string;
  startLine?: number;
  endLine?: number;
  reason: string;
  /** Best-effort estimate of routes hidden behind the gap, when knowable. */
  estimatedRouteCount?: number;
};

export type LaravelHandlerRef = {
  controller: string;
  method: string;
  path: string;
  startLine: number;
  endLine: number;
};

export type LaravelInventoryResult = {
  routes: LaravelRouteRow[];
  handlerRefs: LaravelHandlerRef[];
  advisories: Diagnostic[];
  /** Structured never-silent accounting; feeds the interchange gaps[] array. */
  gaps: LaravelGap[];
};

export type LaravelInventoryInput = {
  path: string;
  parsed: ParsedSource;
  access: RepoFileAccess;
};

const VERB_METHODS = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'any',
  'match',
  'redirect',
  'view',
  'fallback',
]);

const RESOURCE_METHODS = new Set(['resource', 'apiResource']);

/**
 * Route facade calls that legitimately register NO routes — the Router's
 * binding/config API (laravel/framework v13.24.0
 * src/Illuminate/Routing/Router.php: bind, model, pattern(s), macro,
 * resourceVerbs, singularParameters) plus registrar-builder calls that are
 * only meaningful in a chain (prefix/middleware/name/domain/where/namespace/
 * withoutMiddleware/withTrashed). Calls outside every known set advise.
 */
const NON_ROUTE_REGISTRARS = new Set([
  'bind',
  'model',
  'pattern',
  'patterns',
  'macro',
  'can',
  'resourceVerbs',
  'singularParameters',
  'matched',
  'current',
  'currentRouteName',
  'prefix',
  'middleware',
  'name',
  'domain',
  'where',
  'namespace',
  'withoutMiddleware',
  'withTrashed',
  'scoped',
  'covers',
]);

/** PSR-4 prefix → directory, parsed from composer.json "autoload". */
type Psr4Map = ReadonlyMap<string, string>;

type Bindings = ReadonlyMap<string, readonly string[]>;

type WalkContext = {
  prefixes: readonly string[];
  middleware: readonly string[];
  bindings: Bindings;
  conditional: boolean;
};

export async function inventoryLaravelRoutes(
  input: LaravelInventoryInput,
): Promise<LaravelInventoryResult> {
  const routes: LaravelRouteRow[] = [];
  const handlerRefs: LaravelHandlerRef[] = [];
  const advisories: Diagnostic[] = [];
  const gaps: LaravelGap[] = [];
  const advisoryKeys = new Set<string>();
  const gapKeys = new Set<string>();

  const imports = collectUseImports(input.parsed.root);
  const composer = await loadComposerPsr4(input.access);
  const controllerCache = new Map<string, { path: string | null; fqn: string }>();
  const parser = new SourceParser();
  const fileVariables = collectTopLevelArrays(input.parsed.root, imports);

  const advise = (code: string, message: string) => {
    const key = `${code}:${message}`;
    if (advisoryKeys.has(key)) return;
    advisoryKeys.add(key);
    advisories.push({ code, severity: 'observed', subject: input.path, message });
  };

  const recordGap = (gap: LaravelGap) => {
    const key = `${gap.kind}:${gap.sourcePath}:${gap.startLine ?? 0}:${gap.reason}`;
    if (gapKeys.has(key)) return;
    gapKeys.add(key);
    gaps.push(gap);
  };

  /**
   * Best-effort route-count estimate for an included route file (literal
   * includes only): parse through the safe access seam and count Route::
   * facade calls. Unreadable/unparseable targets return undefined — the gap is
   * still emitted, the estimate is simply not claimed (DG-05 review P2).
   */
  const estimateRoutesInFile = async (includePath: string): Promise<number | undefined> => {
    const read = await input.access.readRelative(includePath);
    if (!read.ok) return undefined;
    const parsed = parser.parse(includePath, 'php', read.text);
    try {
      return countRouteCalls(parsed.root);
    } finally {
      parsed.dispose();
    }
  };

  const resolveHandlerRef = async (
    controller: string,
    action: string,
  ): Promise<LaravelHandlerRef | null> => {
    let entry = controllerCache.get(controller);
    if (!entry) {
      // Legacy Laravel string actions ('Auth\\LoginController@login') resolve
      // against the default App\\Http\\Controllers namespace when the raw name
      // has no PSR-4 file; class-constant references are already absolute.
      const direct = composer ? resolvePsr4Path(controller, composer) : null;
      const legacy = composer
        ? resolvePsr4Path(`App\\Http\\Controllers\\${controller}`, composer)
        : null;
      entry = direct
        ? { path: direct, fqn: controller }
        : legacy
          ? { path: legacy, fqn: `App\\Http\\Controllers\\${controller}` }
          : { path: null, fqn: controller };
      controllerCache.set(controller, entry);
    }
    if (!entry.path) {
      advise(
        ARXIC_SOURCE_HANDLER_UNRESOLVED,
        `controller ${entry.fqn} has no PSR-4 file (action ${action})`,
      );
      return null;
    }
    const read = await input.access.readRelative(entry.path);
    if (!read.ok) {
      advise(
        ARXIC_SOURCE_HANDLER_UNRESOLVED,
        `controller file ${entry.path} for ${controller}@${action} unreadable (${read.reason})`,
      );
      return null;
    }
    const parsed = parser.parse(entry.path, 'php', read.text);
    try {
      const anchor = findMethodAnchor(parsed.root, action);
      if (!anchor) {
        advise(
          ARXIC_SOURCE_HANDLER_UNRESOLVED,
          `controller ${entry.fqn} has no method ${action} (${entry.path})`,
        );
        return null;
      }
      return {
        controller: entry.fqn,
        method: action,
        path: entry.path,
        startLine: anchor.startLine,
        endLine: anchor.endLine,
      };
    } finally {
      parsed.dispose();
    }
  };

  const walk = async (node: SyntaxNode, ctx: WalkContext): Promise<void> => {
    for (const child of node.namedChildren) {
      switch (child.type) {
        case 'expression_statement': {
          const expr = child.namedChildren[0];
          if (expr) await handleExpression(expr, ctx);
          break;
        }
        case 'if_statement':
        case 'else_clause':
        case 'elseif_clause':
          // Routes inside runtime-evaluated conditionals may not exist at
          // runtime — rows are still emitted, marked conditional (DG-02
          // interchange semantics).
          await walk(child, ctx.conditional ? ctx : { ...ctx, conditional: true });
          break;
        case 'compound_statement':
          await walk(child, ctx);
          break;
        case 'foreach_statement':
          await handleForeach(child, ctx);
          break;
        case 'class_declaration':
        case 'enum_declaration':
        case 'trait_declaration': {
          // Service providers register routes from inside methods
          // (BookStack's RouteServiceProvider::mapApiRoutes wraps
          // `require base_path('routes/api.php')` in a group) — descend.
          const list = child.namedChildren.find(
            (grandchild) => grandchild.type === 'declaration_list',
          );
          if (list) await walk(list, ctx);
          break;
        }
        case 'method_declaration':
        case 'function_definition': {
          const body = child.childForFieldName('body');
          if (body) await walk(body, ctx);
          break;
        }
        default:
          break;
      }
    }
  };

  const handleForeach = async (node: SyntaxNode, ctx: WalkContext): Promise<void> => {
    const iterable = node.namedChildren.find(
      (child) => child.type === 'variable_name' || child.type === 'member_access_expression',
    );
    const pair = node.namedChildren.find((child) => child.type === 'pair');
    const body = node.childForFieldName('body');
    if (!iterable || !body || !pair) {
      // `foreach ($x as $y)` without a key binding cannot feed URI interpolation;
      // still walk the body for statically-resolvable routes.
      if (body) await walk(body, ctx);
      return;
    }
    const binding = bindingsFromForeach(iterable, pair, fileVariables);
    if (!binding) {
      const count = countRouteCalls(body);
      if (count === 0) {
        // Non-literal loops that declare no routes (config-file iteration etc.)
        // are not inventory gaps — walk through for nested resolvable routes.
        await walk(body, ctx);
        return;
      }
      advise(
        ARXIC_SOURCE_ROUTE_DYNAMIC_REGISTRATION,
        `foreach over a non-literal iterable declares ${count} route call(s) that cannot be statically resolved`,
      );
      recordGap({
        kind: 'dynamic-registration',
        sourcePath: input.path,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        reason: `foreach over a non-literal iterable declares route call(s) that cannot be statically resolved`,
        estimatedRouteCount: count,
      });
      return;
    }
    const [keyVar, valueVar] = pair.namedChildren;
    const keys = binding.keys;
    const values = binding.values;
    for (let index = 0; index < values.length; index += 1) {
      const map = new Map<string, readonly string[]>([
        [keyVar.text, [keys[index] ?? String(index)]],
        [valueVar.text, [values[index] ?? '']],
      ]);
      await walk(body, { ...ctx, bindings: map });
    }
  };

  const handleExpression = async (expr: SyntaxNode, ctx: WalkContext): Promise<void> => {
    if (expr.type === 'member_call_expression' || expr.type === 'scoped_call_expression') {
      const chain = flattenChain(expr);
      if (chain) await handleChain(chain, ctx);
      return;
    }
    if (expr.type === 'assignment_expression') {
      // already harvested by collectTopLevelArrays
      return;
    }
    if (
      expr.type === 'require_expression' ||
      expr.type === 'require_once_expression' ||
      expr.type === 'include_expression' ||
      expr.type === 'include_once_expression'
    ) {
      // A route file included from another file (the BookStack
      // RouteServiceProvider shape): the included file is scanned standalone
      // but the INCLUDING group's prefix/middleware cannot be applied by the
      // per-file scan — surfaced, never silent.
      const call = expr.namedChildren[0] ?? expr;
      const includeCall = basePathIncludeCall(call);
      if (includeCall) {
        const reason =
          includeCall.path !== null
            ? `includes route file ${includeCall.path} (including group context not applied)`
            : 'includes a route file whose path is computed at runtime';
        const estimate =
          includeCall.path !== null ? await estimateRoutesInFile(includeCall.path) : undefined;
        advise(
          ARXIC_SOURCE_ROUTE_FILE_INCLUDE,
          `a ${expr.type.replace('_expression', '')} statement ${reason}`,
        );
        recordGap({
          kind: 'unresolved-file',
          sourcePath: input.path,
          startLine: expr.startPosition.row + 1,
          endLine: expr.endPosition.row + 1,
          reason,
          ...(estimate !== undefined ? { estimatedRouteCount: estimate } : {}),
        });
      }
      return;
    }
    // Other statement-level expressions cannot declare routes.
  };

  const handleChain = async (
    chain: { base: SyntaxNode; members: readonly SyntaxNode[] },
    ctx: WalkContext,
  ): Promise<void> => {
    const base = chain.base;
    const method = methodName(base);
    if (!isRouteFacade(base)) return;

    const members = chain.members;
    const memberNames = members.map((member) => methodName(member));
    const chainNames = [method, ...memberNames];

    // The registrar may sit anywhere in the chain: at the head
    // (`Route::get(...)->name(...)`) or behind registrar builders
    // (`Route::middleware('auth')->get(...)` — RouteRegistrar passthrough).
    // Builders BEFORE the registrar become prefix/middleware context.
    const registrarIndex = chainNames.findIndex(
      (name) => VERB_METHODS.has(name) || RESOURCE_METHODS.has(name) || name === 'group',
    );
    if (registrarIndex === -1) {
      // Unknown `Route::` facade constructs are never silently dropped: the
      // documented non-route registration API (bind/model/pattern/…,
      // laravel/framework v13.24.0 Router public methods) is whitelisted, and
      // anything else advises + records an `unsupported` gap.
      const unknownName = chainNames.find((name) => !NON_ROUTE_REGISTRARS.has(name));
      if (unknownName !== undefined) {
        advise(
          ARXIC_SOURCE_ROUTE_UNSUPPORTED_CONSTRUCT,
          `Route::${unknownName} at line ${base.startPosition.row + 1} is not a known route registrar; the call produced no inventory rows`,
        );
        recordGap({
          kind: 'unsupported',
          sourcePath: input.path,
          startLine: base.startPosition.row + 1,
          endLine: base.endPosition.row + 1,
          reason: `Route::${unknownName} is not a known route registrar`,
        });
      }
      return;
    }

    if (chainNames[registrarIndex] === 'group') {
      const groupCall = method === 'group' ? base : members[memberNames.indexOf('group')];
      const prefixes: string[] = [...ctx.prefixes];
      prefixes.push(...prefixesFromChain(base, method, members, memberNames, ctx));
      const middleware: string[] = [...ctx.middleware];
      middleware.push(...middlewareFromChain(base, method, members, memberNames));
      if (method === 'group') {
        const attrs = attributeArray(argumentNodes(base)[0], imports);
        if (attrs) middleware.push(...attrs.middleware);
      }
      let closure: SyntaxNode | null = null;
      for (const argument of argumentNodes(groupCall)) {
        if (argument.type === 'anonymous_function' || argument.type === 'arrow_function') {
          closure = argument;
        } else {
          // Route::group(attrs, base_path('routes/x.php')) includes another
          // file: the included file is scanned independently, but the including
          // group's prefix/middleware cannot be applied by the per-file scan —
          // surfaced as an advisory + gap, never silent.
          const includeCall = basePathIncludeCall(argument);
          if (includeCall) {
            if (includeCall.path !== null) {
              const estimate = await estimateRoutesInFile(includeCall.path);
              advise(
                ARXIC_SOURCE_ROUTE_FILE_INCLUDE,
                `route file ${includeCall.path} is included via Route::group; the including group prefix (${prefixes.slice(ctx.prefixes.length).join('/') || 'none'}) cannot be applied by the per-file scan`,
              );
              recordGap({
                kind: 'unresolved-file',
                sourcePath: input.path,
                startLine: groupCall.startPosition.row + 1,
                endLine: groupCall.endPosition.row + 1,
                reason: `includes route file ${includeCall.path} (including group context not applied)`,
                ...(estimate !== undefined ? { estimatedRouteCount: estimate } : {}),
              });
            } else {
              advise(
                ARXIC_SOURCE_ROUTE_FILE_INCLUDE,
                `Route::group includes a route file whose path is computed at runtime (line ${groupCall.startPosition.row + 1}); the include cannot be followed statically`,
              );
              recordGap({
                kind: 'unresolved-file',
                sourcePath: input.path,
                startLine: groupCall.startPosition.row + 1,
                endLine: groupCall.endPosition.row + 1,
                reason: 'includes a route file whose path is computed at runtime',
              });
            }
          }
        }
      }
      if (closure) {
        const body = closure.childForFieldName('body');
        if (body) await walk(body, { ...ctx, prefixes, middleware });
      }
      return;
    }

    // Verb/resource registrar — normalize so the handler sees the registrar
    // call as `base` and only its TRAILING modifiers as members; builders that
    // preceded the registrar are merged into the walk context.
    const registrarCall = registrarIndex === 0 ? base : (members[registrarIndex - 1] as SyntaxNode);
    const trailingMembers = members.slice(registrarIndex);
    const trailingNames = memberNames.slice(registrarIndex);
    const builderCtx: WalkContext = {
      ...ctx,
      prefixes: [
        ...ctx.prefixes,
        ...builderPrefixes(chainNames, registrarIndex, base, members, ctx),
      ],
      middleware: [
        ...ctx.middleware,
        ...builderMiddleware(chainNames, registrarIndex, base, members),
      ],
    };

    if (RESOURCE_METHODS.has(chainNames[registrarIndex] ?? '')) {
      await handleResourceRoute(registrarCall, trailingMembers, trailingNames, builderCtx);
      return;
    }

    await handleVerbRoute(registrarCall, trailingMembers, trailingNames, builderCtx);
  };

  /** Prefix context from chain builders that PRECEDE the registrar. */
  const builderPrefixes = (
    chainNames: readonly string[],
    registrarIndex: number,
    base: SyntaxNode,
    members: readonly SyntaxNode[],
    ctx: WalkContext,
  ): string[] => {
    const prefixes: string[] = [];
    for (let index = 0; index < registrarIndex; index += 1) {
      if (chainNames[index] !== 'prefix') continue;
      const call = index === 0 ? base : (members[index - 1] as SyntaxNode);
      const literal = literalStringOrStrings(argumentNodes(call)[0], ctx);
      if (literal) prefixes.push(...literal);
    }
    return prefixes;
  };

  /** Middleware context from chain builders that PRECEDE the registrar. */
  const builderMiddleware = (
    chainNames: readonly string[],
    registrarIndex: number,
    base: SyntaxNode,
    members: readonly SyntaxNode[],
  ): string[] => {
    const middleware: string[] = [];
    for (let index = 0; index < registrarIndex; index += 1) {
      if (chainNames[index] !== 'middleware') continue;
      const call = index === 0 ? base : (members[index - 1] as SyntaxNode);
      for (const argument of argumentNodes(call)) {
        middleware.push(...middlewareValues(argument, imports));
      }
    }
    return middleware;
  };

  const middlewareFromChain = (
    base: SyntaxNode,
    method: string,
    members: readonly SyntaxNode[],
    memberNames: readonly string[],
  ): string[] => {
    const middleware: string[] = [];
    const collect = (call: SyntaxNode, name: string): void => {
      if (name !== 'middleware') return;
      for (const argument of argumentNodes(call)) {
        middleware.push(...middlewareValues(argument, imports));
      }
    };
    collect(base, method);
    members.forEach((member, index) => collect(member, memberNames[index] ?? ''));
    return middleware;
  };

  const prefixesFromChain = (
    base: SyntaxNode,
    method: string,
    members: readonly SyntaxNode[],
    memberNames: readonly string[],
    ctx: WalkContext,
  ): string[] => {
    const prefixes: string[] = [];
    // `Route::prefix('api')->middleware('api')->group($fn)` — the prefix is the
    // base scoped call itself.
    if (method === 'prefix') {
      const literal = literalStringOrStrings(argumentNodes(base)[0], ctx);
      if (literal) prefixes.push(...literal);
    }
    members.forEach((member, index) => {
      if (memberNames[index] === 'prefix') {
        const literal = literalStringOrStrings(argumentNodes(member)[0], ctx);
        if (literal) prefixes.push(...literal);
      }
    });
    if (method === 'group') {
      const attrs = attributeArray(argumentNodes(base)[0], imports);
      if (attrs) prefixes.push(...attrs.prefix);
    }
    return prefixes;
  };

  const handleVerbRoute = async (
    base: SyntaxNode,
    members: readonly SyntaxNode[],
    memberNames: readonly string[],
    ctx: WalkContext,
  ): Promise<void> => {
    const method = methodName(base);
    const args = argumentNodes(base);
    const startLine = base.startPosition.row + 1;
    const endLine = base.endPosition.row + 1;
    const name = memberValue(members, memberNames, 'name');
    const kind = ctx.bindings.size > 0 ? 'loop-resolved' : 'static';

    let uriIndex = method === 'match' ? 1 : 0;
    if (method === 'fallback') {
      // Route::fallback($action) takes no URI — it registers the catch-all.
      uriIndex = -1;
    } else if (method === 'match') {
      const list = args[0] ? stringArrayValues(args[0]) : null;
      if (!list) {
        advise(
          ARXIC_SOURCE_ROUTE_DYNAMIC_REGISTRATION,
          `Route::match at line ${startLine} has a non-literal method list`,
        );
        recordGap({
          kind: 'dynamic-registration',
          sourcePath: input.path,
          startLine,
          endLine,
          reason: 'Route::match method list cannot be statically resolved',
        });
        return;
      }
    }

    const rawUri = method === 'fallback' ? '/' : await resolveUri(args[uriIndex] ?? args[0], ctx);
    if (rawUri === null) {
      advise(
        ARXIC_SOURCE_ROUTE_DYNAMIC_REGISTRATION,
        `Route::${method} declares a route whose URI cannot be statically resolved (line ${startLine})`,
      );
      recordGap({
        kind: 'dynamic-registration',
        sourcePath: input.path,
        startLine,
        endLine,
        reason: `Route::${method} URI cannot be statically resolved`,
      });
      return;
    }

    let httpMethods: string[];
    if (method === 'match') {
      const list = (args[0] ? stringArrayValues(args[0]) : []) ?? [];
      httpMethods = list.map((verb) => verb.toUpperCase());
    } else if (method === 'any' || method === 'fallback') {
      httpMethods = ['ANY'];
    } else if (method === 'redirect' || method === 'view') {
      httpMethods = ['GET'];
      uriIndex = 0;
    } else {
      httpMethods = [method.toUpperCase()];
    }

    const actionNode =
      method === 'redirect' || method === 'view'
        ? undefined
        : method === 'fallback'
          ? args[0]
          : args[uriIndex + 1];
    const resolvedAction = actionNode ? await resolveHandlerAction(actionNode, ctx) : null;
    const handler =
      resolvedAction &&
      resolvedAction !== 'closure' &&
      resolvedAction !== 'dynamic' &&
      resolvedAction !== 'none'
        ? resolvedAction
        : null;
    if (resolvedAction === 'dynamic') {
      // The route surface itself is statically known; only the handler is not.
      // Keep the row visible and record the gap (ADR-008 Decision 2).
      advise(
        ARXIC_SOURCE_HANDLER_UNRESOLVED,
        `Route::${method} at line ${startLine} has a non-static action`,
      );
    }

    const rowMiddleware = [
      ...ctx.middleware,
      ...middlewareFromChain(base, method, members, memberNames),
    ].filter((value, index, all) => all.indexOf(value) === index);
    for (const httpMethod of httpMethods) {
      routes.push({
        method: httpMethod,
        uri: normalizeUri(ctx.prefixes, [rawUri]),
        name,
        controller: handler ? handler.controller : undefined,
        action: handler
          ? handler.action
          : method === 'view'
            ? 'view'
            : method === 'redirect'
              ? 'redirect'
              : resolvedAction === 'closure'
                ? 'closure'
                : undefined,
        kind,
        sourcePath: input.path,
        ...(ctx.conditional ? { conditional: true } : {}),
        ...(rowMiddleware.length > 0 ? { middleware: rowMiddleware } : {}),
        startLine,
        endLine,
      });
    }
    if (handler) {
      const ref = await resolveHandlerRef(handler.controller, handler.action);
      if (ref) handlerRefs.push(ref);
    }
  };

  const handleResourceRoute = async (
    base: SyntaxNode,
    members: readonly SyntaxNode[],
    memberNames: readonly string[],
    ctx: WalkContext,
  ): Promise<void> => {
    const method = methodName(base);
    const args = argumentNodes(base);
    const nameArg = args[0] ? literalString(args[0], ctx) : null;
    const startLine = base.startPosition.row + 1;
    const endLine = base.endPosition.row + 1;
    if (nameArg === null) {
      advise(
        ARXIC_SOURCE_ROUTE_DYNAMIC_REGISTRATION,
        `Route::${method} at line ${startLine} has a non-literal resource name`,
      );
      recordGap({
        kind: 'dynamic-registration',
        sourcePath: input.path,
        startLine,
        endLine,
        reason: `Route::${method} resource name cannot be statically resolved`,
      });
      return;
    }
    const controllerArg = args[1] ? classReference(args[1], ctx) : null;
    const only = modifierActionList(members, memberNames, 'only');
    const except = modifierActionList(members, memberNames, 'except');

    const kind = ctx.bindings.size > 0 ? 'loop-resolved' : 'static';
    const rowMiddleware = [
      ...ctx.middleware,
      ...middlewareFromChain(base, method, members, memberNames),
    ].filter((value, index, all) => all.indexOf(value) === index);

    for (const route of expandResource(nameArg, undefined, {
      api: method === 'apiResource',
      only,
      except,
    })) {
      routes.push({
        method: route.method,
        uri: normalizeUri(ctx.prefixes, [route.uri]),
        controller: controllerArg ?? undefined,
        action: route.action,
        kind,
        sourcePath: input.path,
        ...(ctx.conditional ? { conditional: true } : {}),
        ...(rowMiddleware.length > 0 ? { middleware: rowMiddleware } : {}),
        startLine,
        endLine,
      });
    }
    if (controllerArg) {
      for (const action of new Set(
        expandResource(nameArg, undefined, { api: method === 'apiResource', only, except }).map(
          (route) => route.action,
        ),
      )) {
        const ref = await resolveHandlerRef(controllerArg, action);
        if (ref) handlerRefs.push(ref);
      }
    }
  };

  /** Resolves a URI argument node to its literal string, or null when dynamic. */
  const resolveUri = async (
    node: SyntaxNode | undefined,
    ctx: WalkContext,
  ): Promise<string | null> => {
    if (!node) return null;
    if (node.type === 'string') {
      return interpolateString(node, ctx);
    }
    if (node.type === 'encapsed_string') {
      return interpolateString(node, ctx);
    }
    if (node.type === 'variable_name') {
      const bound = ctx.bindings.get(node.text);
      return bound && bound.length === 1 ? (bound[0] as string) : null;
    }
    return null;
  };

  const resolveHandlerAction = async (
    node: SyntaxNode,
    ctx: WalkContext,
  ): Promise<{ controller: string; action: string } | 'closure' | 'none' | 'dynamic' | null> => {
    switch (node.type) {
      case 'class_constant_access_expression': {
        const className = classReference(node, ctx);
        return className ? { controller: className, action: '__invoke' } : 'dynamic';
      }
      case 'array_creation_expression': {
        const elements = node.namedChildren.filter(
          (child) => child.type === 'array_element_initializer',
        );
        if (elements.length !== 2) return 'dynamic';
        // `[Controller::class, 'method']` — each element initializer wraps its
        // value as the last named child.
        const classNode = elements[0]?.namedChildren[elements[0].namedChildren.length - 1];
        const actionNode = elements[1]?.namedChildren[elements[1].namedChildren.length - 1];
        if (!classNode || !actionNode) return 'dynamic';
        const className = classReference(classNode, ctx);
        const action = literalString(actionNode, ctx);
        if (!className || action === null) return 'dynamic';
        return { controller: className, action };
      }
      case 'string': {
        const raw = literalString(node, ctx);
        if (raw === null) return 'dynamic';
        const at = raw.lastIndexOf('@');
        if (at === -1) return { controller: normalizeControllerFqn(raw), action: '__invoke' };
        return {
          controller: normalizeControllerFqn(raw.slice(0, at)),
          action: raw.slice(at + 1),
        };
      }
      case 'anonymous_function':
      case 'arrow_function':
        return 'closure';
      case 'variable_name': {
        const bound = ctx.bindings.get(node.text);
        if (!bound || bound.length !== 1) return 'dynamic';
        const value = bound[0] as string;
        const at = value.lastIndexOf('@');
        if (at === -1) return { controller: normalizeControllerFqn(value), action: '__invoke' };
        return {
          controller: normalizeControllerFqn(value.slice(0, at)),
          action: value.slice(at + 1),
        };
      }
      default:
        return 'none';
    }
  };

  /** Resolves class references (imports, aliases, absolute names) to FQCNs. */
  const classReference = (node: SyntaxNode, ctx: WalkContext): string | null => {
    if (node.type === 'class_constant_access_expression') {
      // `UserController::class` → name child; `SettingControllers\StatusController::class`
      // → qualified_name child.
      const target = node.namedChildren.find(
        (child) => child.type === 'name' || child.type === 'qualified_name',
      );
      if (!target) return null;
      return resolveClassName(target.text);
    }
    if (node.type === 'name') return resolveClassName(node.text);
    if (node.type === 'qualified_name') return node.text.replace(/^\\/u, '');
    if (node.type === 'variable_name') {
      const bound = ctx.bindings.get(node.text);
      if (bound && bound.length === 1) return normalizeControllerFqn(bound[0] as string);
      return null;
    }
    if (node.type === 'string') {
      const raw = literalString(node, ctx);
      return raw === null ? null : normalizeControllerFqn(raw.split('@')[0] ?? raw);
    }
    return null;
  };

  const normalizeControllerFqn = (raw: string): string => {
    const trimmed = raw.replace(/^\\/u, '');
    if (trimmed.includes('\\')) return trimmed;
    // Legacy Laravel string controller ('Auth\LoginController@login') resolves
    // against the default App\Http\Controllers namespace when it is not an FQCN.
    return `App\\Http\\Controllers\\${trimmed}`;
  };

  const resolveClassName = (reference: string): string => {
    const stripped = reference.replace(/^\\/u, '');
    const firstSegment = stripped.split('\\')[0] ?? stripped;
    const imported = imports.get(firstSegment);
    if (imported) {
      const rest = stripped.split('\\').slice(1).join('\\');
      return rest ? `${imported}\\${rest}` : imported;
    }
    return stripped;
  };

  const interpolateString = (node: SyntaxNode, ctx: WalkContext): string | null => {
    if (node.type === 'string') {
      return literalStatic(node);
    }
    if (node.type === 'encapsed_string') {
      let result = '';
      for (const child of node.namedChildren) {
        if (child.type === 'string_content') {
          result += child.text;
        } else if (child.type === 'variable_name' || child.type === 'name') {
          const bound = ctx.bindings.get(child.text);
          if (!bound || bound.length !== 1) return null;
          result += bound[0];
        } else {
          return null;
        }
      }
      return result;
    }
    return null;
  };

  const literalString = (node: SyntaxNode, ctx: WalkContext): string | null =>
    node.type === 'string' || node.type === 'encapsed_string' ? interpolateString(node, ctx) : null;

  await walk(input.parsed.root, {
    prefixes: [],
    middleware: [],
    bindings: new Map(),
    conditional: false,
  });

  return { routes, handlerRefs, advisories, gaps };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function methodName(call: SyntaxNode): string {
  return call.childForFieldName('name')?.text ?? '';
}

function argumentNodes(call: SyntaxNode): SyntaxNode[] {
  const args = call.childForFieldName('arguments');
  if (!args) return [];
  return args.namedChildren
    .filter((child) => child.type === 'argument')
    .map((argument) => argument.namedChildren[0])
    .filter((node): node is SyntaxNode => Boolean(node));
}

function isRouteFacade(base: SyntaxNode): boolean {
  const scope = base.childForFieldName('scope');
  if (!scope) return false;
  return scope.type === 'name' && scope.text.replace(/^\\/u, '').split('\\').pop() === 'Route';
}

function flattenChain(expr: SyntaxNode): { base: SyntaxNode; members: SyntaxNode[] } | null {
  const members: SyntaxNode[] = [];
  let cursor = expr;
  while (cursor.type === 'member_call_expression') {
    members.unshift(cursor);
    const object = cursor.childForFieldName('object');
    if (!object) return null;
    cursor = object;
  }
  if (cursor.type !== 'scoped_call_expression') return null;
  if (!isRouteFacade(cursor)) return null;
  return { base: cursor, members };
}

function memberValue(
  members: readonly SyntaxNode[],
  memberNames: readonly string[],
  name: string,
): string | undefined {
  const index = memberNames.indexOf(name);
  if (index === -1) return undefined;
  const argument = argumentNodes(members[index] as SyntaxNode)[0];
  if (!argument || argument.type !== 'string') return undefined;
  const inner = argument.namedChildren.find((child) => child.type === 'string_content');
  return inner?.text;
}

function modifierActionList(
  members: readonly SyntaxNode[],
  memberNames: readonly string[],
  name: string,
): readonly ResourceAction[] | undefined {
  const index = memberNames.indexOf(name);
  if (index === -1) return undefined;
  const values: string[] = [];
  for (const argument of argumentNodes(members[index] as SyntaxNode)) {
    if (argument.type === 'string') {
      const literal = literalStatic(argument);
      if (literal === null) continue;
      values.push(literal);
    } else if (argument.type === 'array_creation_expression') {
      values.push(...(stringArrayValues(argument) ?? []));
    }
  }
  if (values.length === 0) return undefined;
  return values.filter((value): value is ResourceAction =>
    ['index', 'create', 'store', 'show', 'edit', 'update', 'destroy'].includes(value),
  );
}

function literalStringOrStrings(
  node: SyntaxNode | undefined,
  ctx: { bindings: Bindings },
): string[] | null {
  if (!node) return null;
  if (node.type === 'string') {
    const value = literalStatic(node);
    return value === null ? null : [value];
  }
  if (node.type === 'array_creation_expression') {
    const values = stringArrayValues(node);
    return values;
  }
  if (node.type === 'variable_name') {
    const bound = ctx.bindings.get(node.text);
    return bound ? [...bound] : null;
  }
  return null;
}

function literalStatic(node: SyntaxNode): string | null {
  if (node.type !== 'string') return null;
  // Raw text carries backslash escape sequences as written (e.g. the two
  // string_content + escape_sequence children of 'Auth\LoginController@login');
  // strip the quotes and unescape rather than reading only the first child.
  const raw = node.text;
  if (raw.length < 2 || !raw.startsWith("'") || !raw.endsWith("'")) return null;
  return unescapeSingleQuoted(raw.slice(1, -1));
}

function stringArrayValues(node: SyntaxNode): string[] | null {
  if (node.type !== 'array_creation_expression') return null;
  const values: string[] = [];
  for (const element of node.namedChildren) {
    if (element.type !== 'array_element_initializer') continue;
    const value = element.namedChildren[element.namedChildren.length - 1];
    if (!value) return null;
    if (value.type !== 'string') return null;
    const literal = literalStatic(value);
    if (literal === null) return null;
    values.push(literal);
  }
  return values;
}

function attributeArray(
  node: SyntaxNode | undefined,
  imports?: ReadonlyMap<string, string>,
): { prefix: string[]; middleware: string[] } | null {
  if (!node || node.type !== 'array_creation_expression') return null;
  const prefix: string[] = [];
  const middleware: string[] = [];
  for (const element of node.namedChildren) {
    if (element.type !== 'array_element_initializer') continue;
    const [key, value] = element.namedChildren;
    if (!key || !value || key.type !== 'string') continue;
    const keyText = key.namedChildren.find((child) => child.type === 'string_content')?.text;
    if (keyText === 'prefix') {
      if (value.type === 'string') {
        const literal = literalStatic(value);
        if (literal !== null) prefix.push(literal);
      } else if (value.type === 'array_creation_expression') {
        prefix.push(...(stringArrayValues(value) ?? []));
      }
    } else if (keyText === 'middleware') {
      middleware.push(...middlewareValues(value, imports ?? new Map()));
    }
  }
  return { prefix, middleware };
}

/**
 * Middleware argument values: string aliases ('auth'), arrays mixing aliases
 * and class constants ([EnsureFrontendRequestsAreStateful::class, 'throttle']),
 * and class-constant references resolved through the file's use-imports
 * (route:list shows fully-qualified class middleware).
 */
function middlewareValues(node: SyntaxNode, imports: ReadonlyMap<string, string>): string[] {
  if (node.type === 'string') {
    const literal = literalStatic(node);
    return literal !== null ? [literal] : [];
  }
  if (node.type === 'array_creation_expression') {
    const values: string[] = [];
    for (const element of node.namedChildren) {
      if (element.type !== 'array_element_initializer') continue;
      const value = element.namedChildren[element.namedChildren.length - 1];
      if (value) values.push(...middlewareValues(value, imports));
    }
    return values;
  }
  if (node.type === 'class_constant_access_expression') {
    const target = node.namedChildren.find(
      (child) => child.type === 'name' || child.type === 'qualified_name',
    );
    if (!target) return [];
    const reference = target.text.replace(/^\\/u, '');
    const first = reference.split('\\')[0] ?? reference;
    return [imports.get(first) ?? reference];
  }
  return [];
}

/**
 * Resolves `base_path('routes/api.php')`-shaped include arguments. Returns
 * `{ path: string }` for literal includes and `{ path: null }` for base_path
 * calls whose argument is NOT a literal (koel's
 * `base_path(sprintf('routes/%s.base.php', $type))`) — a dynamic include the
 * per-file scan cannot follow, which callers must surface, never drop.
 */
function basePathIncludeCall(node: SyntaxNode): { path: string } | { path: null } | null {
  if (node.type !== 'function_call_expression') return null;
  // tree-sitter-php: the callee of a plain function call is the `function` field.
  const name = node.childForFieldName('function');
  if (!name || name.type !== 'name' || name.text !== 'base_path') return null;
  const argument = argumentNodes(node)[0];
  if (!argument) return { path: null };
  if (argument.type !== 'string') return { path: null };
  const literal = literalStatic(argument);
  return literal === null ? { path: null } : { path: literal };
}

function collectUseImports(root: SyntaxNode): Map<string, string> {
  const imports = new Map<string, string>();
  for (const statement of root.namedChildren) {
    if (statement.type !== 'namespace_use_declaration') continue;
    const group = statement.namedChildren.find((child) => child.type === 'namespace_use_group');
    if (group) {
      const prefix = statement.namedChildren
        .find((child) => child.type === 'namespace_name')
        ?.text.replace(/\\$/u, '');
      for (const clause of group.namedChildren) {
        if (clause.type !== 'namespace_use_clause') continue;
        const name = clause.namedChildren.find((child) => child.type === 'name');
        const alias = clause.childForFieldName('alias')?.text ?? name?.text;
        if (name && alias) {
          imports.set(alias, prefix ? `${prefix}\\${name.text}` : name.text);
        }
      }
      continue;
    }
    for (const clause of statement.namedChildren) {
      if (clause.type !== 'namespace_use_clause') continue;
      const qualified = clause.namedChildren.find((child) => child.type === 'qualified_name');
      if (!qualified) continue;
      const fqn = qualified.text.replace(/^\\/u, '');
      const alias =
        clause.childForFieldName('alias')?.text ??
        qualified.childForFieldName('name')?.text ??
        fqn.split('\\').pop();
      if (alias) imports.set(alias, fqn);
    }
  }
  return imports;
}

type TopLevelArray = { keys: string[]; values: string[] };

function collectTopLevelArrays(
  root: SyntaxNode,
  imports: Map<string, string>,
): Map<string, TopLevelArray> {
  const arrays = new Map<string, TopLevelArray>();
  for (const statement of root.namedChildren) {
    if (statement.type !== 'expression_statement') continue;
    const assignment = statement.namedChildren.find(
      (child) => child.type === 'assignment_expression',
    );
    if (!assignment) continue;
    const left = assignment.namedChildren[0];
    const right = assignment.namedChildren[1];
    if (!left || left.type !== 'variable_name' || !right) continue;
    if (right.type !== 'array_creation_expression') continue;
    const keys: string[] = [];
    const values: string[] = [];
    let literal = true;
    for (const element of right.namedChildren) {
      if (element.type !== 'array_element_initializer') continue;
      const parts = element.namedChildren;
      if (parts.length === 2) {
        const key = literalStatic(parts[0] as SyntaxNode);
        const value = elementValue(parts[1] as SyntaxNode, imports);
        if (key === null || value === null) {
          literal = false;
          break;
        }
        keys.push(key);
        values.push(value);
      } else {
        const value = elementValue(parts[0] as SyntaxNode, imports);
        if (value === null) {
          literal = false;
          break;
        }
        keys.push(String(keys.length));
        values.push(value);
      }
    }
    if (literal) arrays.set(left.text, { keys, values });
  }
  return arrays;
}

function elementValue(node: SyntaxNode, imports: Map<string, string>): string | null {
  if (node.type === 'string') return literalStatic(node);
  if (node.type === 'class_constant_access_expression') {
    const target = node.namedChildren.find(
      (child) => child.type === 'name' || child.type === 'qualified_name',
    );
    if (!target) return null;
    const reference = target.text.replace(/^\\/u, '');
    const first = reference.split('\\')[0] ?? reference;
    const imported = imports.get(first);
    return imported ?? reference;
  }
  return null;
}

function bindingsFromForeach(
  iterable: SyntaxNode,
  pair: SyntaxNode,
  fileVariables: Map<string, TopLevelArray>,
): TopLevelArray | null {
  if (iterable.type !== 'variable_name') return null;
  const array = fileVariables.get(iterable.text);
  if (!array) return null;
  void pair;
  return array;
}

function countRouteCalls(node: SyntaxNode): number {
  let count = 0;
  const visit = (cursor: SyntaxNode): void => {
    if (cursor.type === 'scoped_call_expression' && isRouteFacade(cursor)) count += 1;
    for (const child of cursor.namedChildren) visit(child);
  };
  visit(node);
  return count;
}

function findMethodAnchor(
  root: SyntaxNode,
  method: string,
): { startLine: number; endLine: number } | null {
  let anchor: { startLine: number; endLine: number } | null = null;
  const visit = (node: SyntaxNode): void => {
    if (anchor) return;
    if (node.type === 'method_declaration') {
      const name = node.childForFieldName('name');
      if (name?.text === method) {
        anchor = { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 };
        return;
      }
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(root);
  return anchor;
}

async function loadComposerPsr4(access: RepoFileAccess): Promise<Psr4Map | null> {
  const read = await access.readRelative('composer.json');
  if (!read.ok) return null;
  try {
    const parsed = JSON.parse(read.text) as {
      autoload?: { 'psr-4'?: Record<string, string | string[]> };
    };
    const psr4 = parsed.autoload?.['psr-4'];
    if (!psr4) return null;
    const map = new Map<string, string>();
    for (const [prefix, directories] of Object.entries(psr4)) {
      const directory = Array.isArray(directories) ? directories[0] : directories;
      if (typeof directory === 'string') {
        map.set(prefix.replace(/\\$/u, ''), directory.replace(/\/$/u, ''));
      }
    }
    return map;
  } catch {
    return null;
  }
}

function resolvePsr4Path(fqn: string, psr4: Psr4Map): string | null {
  const prefixes = [...psr4.keys()].sort((a, b) => b.length - a.length);
  for (const prefix of prefixes) {
    if (fqn.startsWith(`${prefix}\\`) || fqn === prefix) {
      const directory = psr4.get(prefix) ?? '';
      const rest = fqn === prefix ? '' : fqn.slice(prefix.length + 1).replaceAll('\\', '/');
      return [directory, `${rest}.php`].filter((part) => part !== '').join('/');
    }
  }
  return null;
}

function unescapeSingleQuoted(value: string): string {
  return value.replaceAll('\\\\', '\\').replaceAll("\\'", "'");
}

function normalizeUri(prefixes: readonly string[], segments: readonly string[]): string {
  const parts = [...prefixes, ...segments]
    .flatMap((segment) => segment.split('/'))
    .map((segment) => segment.replace(/^\/+|\/+$/gu, ''))
    .filter((segment) => segment !== '');
  return `/${parts.join('/')}`;
}
