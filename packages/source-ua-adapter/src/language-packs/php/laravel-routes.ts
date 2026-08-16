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
  startLine: number;
  endLine: number;
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

/** PSR-4 prefix → directory, parsed from composer.json "autoload". */
type Psr4Map = ReadonlyMap<string, string>;

type Bindings = ReadonlyMap<string, readonly string[]>;

type WalkContext = {
  prefixes: readonly string[];
  bindings: Bindings;
};

export async function inventoryLaravelRoutes(
  input: LaravelInventoryInput,
): Promise<LaravelInventoryResult> {
  const routes: LaravelRouteRow[] = [];
  const handlerRefs: LaravelHandlerRef[] = [];
  const advisories: Diagnostic[] = [];
  const advisoryKeys = new Set<string>();

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
        case 'compound_statement':
        case 'else_clause':
        case 'elseif_clause':
          await walk(child, ctx);
          break;
        case 'foreach_statement':
          await handleForeach(child, ctx);
          break;
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

    if (memberNames.includes('group') || method === 'group') {
      const groupCall = method === 'group' ? base : members[memberNames.indexOf('group')];
      const prefixes: string[] = [...ctx.prefixes];
      prefixes.push(...prefixesFromChain(base, method, members, memberNames, ctx));
      for (const argument of argumentNodes(groupCall)) {
        if (argument.type === 'anonymous_function' || argument.type === 'arrow_function') {
          const body = argument.childForFieldName('body');
          if (body) await walk(body, { ...ctx, prefixes });
        } else if (argument.type === 'string') {
          // Route::group([], base_path('routes/x.php')) includes another file;
          // that file is scanned independently. The including group's prefix is
          // not applied to it — recorded as a limitation in the spike report.
        }
      }
      return;
    }

    if (RESOURCE_METHODS.has(method)) {
      await handleResourceRoute(base, members, memberNames, ctx);
      return;
    }

    if (VERB_METHODS.has(method)) {
      await handleVerbRoute(base, members, memberNames, ctx);
    }
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
      const attrs = attributeArray(argumentNodes(base)[0]);
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
        return;
      }
    }

    const rawUri = method === 'fallback' ? '/' : await resolveUri(args[uriIndex] ?? args[0], ctx);
    if (rawUri === null) {
      advise(
        ARXIC_SOURCE_ROUTE_DYNAMIC_REGISTRATION,
        `Route::${method} declares a route whose URI cannot be statically resolved (line ${startLine})`,
      );
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
    if (nameArg === null) {
      advise(
        ARXIC_SOURCE_ROUTE_DYNAMIC_REGISTRATION,
        `Route::${method} at line ${base.startPosition.row + 1} has a non-literal resource name`,
      );
      return;
    }
    const controllerArg = args[1] ? classReference(args[1], ctx) : null;
    const only = modifierActionList(members, memberNames, 'only');
    const except = modifierActionList(members, memberNames, 'except');

    const startLine = base.startPosition.row + 1;
    const endLine = base.endPosition.row + 1;
    const kind = ctx.bindings.size > 0 ? 'loop-resolved' : 'static';

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

  await walk(input.parsed.root, { prefixes: [], bindings: new Map() });

  return { routes, handlerRefs, advisories };
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

function attributeArray(node: SyntaxNode | undefined): { prefix: string[] } | null {
  if (!node || node.type !== 'array_creation_expression') return null;
  const prefix: string[] = [];
  for (const element of node.namedChildren) {
    if (element.type !== 'array_element_initializer') continue;
    const [key, value] = element.namedChildren;
    if (!key || !value || key.type !== 'string') continue;
    const keyText = key.namedChildren.find((child) => child.type === 'string_content')?.text;
    if (keyText !== 'prefix') continue;
    if (value.type === 'string') {
      const literal = literalStatic(value);
      if (literal !== null) prefix.push(literal);
    } else if (value.type === 'array_creation_expression') {
      prefix.push(...(stringArrayValues(value) ?? []));
    }
  }
  return { prefix };
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
