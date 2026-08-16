// Laravel resource-route expansion, ported from the reference implementation in
// laravel/framework v13.24.0 (MIT) src/Illuminate/Routing/ResourceRegistrar.php:
//   - register()            L79-136  (defaults order, wildcard from last dot segment)
//   - getResourceMethods()  L270-283 (only/except filtering)
//   - addResource{Index,Create,Store,Show,Edit,Update,Destroy} L294-423 (URIs + verbs)
//   - getResourceUri()      L577-591 (dot-nesting, trailing param stripped then re-added)
//   - getResourceWildcard() L615-626 (Str::singular + '-' → '_')
// and Router.php:382-393 (apiResource only-list = index, show, store, update, destroy).
// PUT+PATCH are separate rows here because Arxic's inventory denominator counts
// URI×HTTP-method surfaces (Laravel registers update as one route matching two verbs).

import { singularize } from './singularize';

export type ResourceAction = 'index' | 'create' | 'store' | 'show' | 'edit' | 'update' | 'destroy';

export type ResourceVerbRoute = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  uri: string;
  action: ResourceAction;
};

export type ResourceExpansionOptions = {
  api?: boolean;
  only?: readonly ResourceAction[];
  except?: readonly ResourceAction[];
};

const RESOURCE_DEFAULTS: readonly ResourceAction[] = [
  'index',
  'create',
  'store',
  'show',
  'edit',
  'update',
  'destroy',
];

const API_ONLY: readonly ResourceAction[] = ['index', 'show', 'store', 'update', 'destroy'];

/** ResourceRegistrar::getResourceWildcard — singularized, dashes to underscores. */
export function resourceWildcard(segment: string): string {
  return singularize(segment).replaceAll('-', '_');
}

/** ResourceRegistrar::getResourceUri — nested `a.b` → `a/{a}/b` (trailing param stripped). */
export function resourceUri(name: string): string {
  if (!name.includes('.')) return name;
  const segments = name.split('.');
  const nested = segments.map((segment) => `${segment}/{${resourceWildcard(segment)}}`).join('/');
  const trailing = `/{${resourceWildcard(segments[segments.length - 1] ?? '')}}`;
  return nested.replace(trailing, '');
}

export function expandResource(
  name: string,
  _controller?: string,
  options: ResourceExpansionOptions = {},
): ResourceVerbRoute[] {
  // ResourceRegistrar::prefixedResource — 'admin/photos' means prefix 'admin'.
  const [baseName, ...prefixSegments] = name.includes('/')
    ? ((): [string, string[]] => {
        const parts = name.split('/');
        return [parts.pop() ?? name, parts];
      })()
    : [name, []];
  const prefix = prefixSegments.join('/');

  // Router::apiResource applies only=[index,show,store,update,destroy] first, but
  // getResourceMethods filters via array_intersect, which preserves the DEFAULTS order.
  let methods: readonly ResourceAction[] = options.api
    ? RESOURCE_DEFAULTS.filter((action) => API_ONLY.includes(action))
    : RESOURCE_DEFAULTS;
  if (options.only) methods = methods.filter((method) => options.only?.includes(method));
  if (options.except) methods = methods.filter((method) => !options.except?.includes(method));

  const uri = resourceUri(baseName);
  const wildcard = resourceWildcard(baseName.split('.').pop() ?? baseName);
  const routes: ResourceVerbRoute[] = [];
  for (const action of methods) {
    const actionUri =
      action === 'create'
        ? `${uri}/create`
        : action === 'edit'
          ? `${uri}/{${wildcard}}/edit`
          : action === 'index' || action === 'store'
            ? uri
            : `${uri}/{${wildcard}}`;
    const method: ResourceVerbRoute['method'] =
      action === 'store'
        ? 'POST'
        : action === 'update'
          ? 'PUT'
          : action === 'destroy'
            ? 'DELETE'
            : 'GET';
    if (action === 'update') {
      routes.push({ method: 'PUT', uri: actionUri, action });
      routes.push({ method: 'PATCH', uri: actionUri, action });
      continue;
    }
    routes.push({ method, uri: actionUri, action });
  }

  return prefix ? routes.map((route) => ({ ...route, uri: `${prefix}/${route.uri}` })) : routes;
}
