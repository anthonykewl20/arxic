// Route Inventory Interchange v1 — producer side.
//
// This module mirrors the DG-02-documented interchange contract
// (`packages/domain-inventory-spike/src/interchange.ts`, the Domain
// Inventory's input contract per issue #246 deliverable 1) field-for-field.
// DG-05 owns the explicit translator from the pack's extraction shape to this
// interchange (contract-drift note on #249); conformance is enforced by
// integration tests that run the REAL DG-02 `validateInterchange` over this
// module's output — the mirror here exists so the production package carries
// no dependency on a spike package (the spike dev-depends on THIS package;
// a runtime edge in reverse would cycle).
//
// Design anchor (per DG-02): Laravel's own `route:list --json` per-route
// shape, extended with line anchors, per-file sha256, explicit `conditional`
// marking, and a `gaps` array so a producer accounts for what it could NOT
// enumerate — never a silent drop.

import type { LaravelGap, LaravelRouteRow } from './php/laravel-routes';

export const INTERCHANGE_SCHEMA_VERSION = 1;

export const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

export type InterchangeRoute = {
  methods: HttpMethod[];
  uri: string;
  name?: string;
  action?: string;
  middleware?: string[];
  sourcePath: string;
  startLine: number;
  endLine: number;
  conditional?: boolean;
};

export type InterchangeGap = {
  kind: LaravelGap['kind'];
  sourcePath: string;
  startLine?: number;
  endLine?: number;
  reason: string;
};

export type RouteInventoryInterchange = {
  schemaVersion: typeof INTERCHANGE_SCHEMA_VERSION;
  packId: string;
  language: string;
  framework?: string;
  standIn: boolean;
  provenance: { repository: string; commit: string };
  routes: InterchangeRoute[];
  gaps: InterchangeGap[];
  files: Array<{ path: string; sha256: string }>;
};

/** Laravel `Route::any`/`Route::fallback` match every verb (Router::$verbs). */
const ANY_METHODS: readonly HttpMethod[] = HTTP_METHODS;

/**
 * Translate pack route rows + structured gaps into one interchange document.
 * Deterministic: routes, gaps, and files are codepoint-sorted (the DG-02
 * stand-in's ordering) so repeat runs are byte-identical.
 *
 * Route rows arrive as one row per HTTP method (the evidence model: each
 * `route:METHOD uri` EvidenceRef is its own unit). The interchange is anchored
 * on Laravel's `route:list`, where ONE registration carries all its methods
 * ("GET|HEAD", "PUT|PATCH") — so rows sharing a file anchor + URI merge into a
 * single interchange route with the union of methods, declaration-ordered.
 */
export function toRouteInventoryInterchange(input: {
  packId: string;
  language: string;
  framework?: string;
  provenance: { repository: string; commit: string };
  routes: readonly LaravelRouteRow[];
  gaps: readonly LaravelGap[];
  files: ReadonlyArray<{ path: string; sha256: string }>;
}): RouteInventoryInterchange {
  const merged = new Map<string, InterchangeRoute>();
  for (const row of input.routes) {
    const methods = row.method === 'ANY' ? [...ANY_METHODS] : ([row.method] as HttpMethod[]);
    // Merge key includes the resolved action: `Route::match(['get','post'],…)`
    // rows and a resource's PUT/PATCH `update` pair share an action and merge
    // (route:list shows one registration); a resource's index vs store are
    // distinct actions and stay distinct routes.
    const actionIdentity = (() => {
      const mapped = actionOf(row);
      return mapped.action ?? '';
    })();
    const key = `${row.sourcePath}\0${row.startLine}\0${row.endLine}\0${row.uri}\0${actionIdentity}`;
    const existing = merged.get(key);
    if (existing) {
      for (const method of methods) {
        if (!existing.methods.includes(method)) existing.methods.push(method);
      }
      continue;
    }
    merged.set(key, {
      methods,
      ...(row.name !== undefined ? { name: row.name } : {}),
      ...actionOf(row),
      ...(row.middleware !== undefined ? { middleware: row.middleware } : {}),
      uri: row.uri,
      sourcePath: row.sourcePath,
      startLine: row.startLine,
      endLine: row.endLine,
      ...(row.conditional === true ? { conditional: true } : {}),
    });
  }
  const routes = [...merged.values()].sort((a, b) =>
    codepointCompare(
      `${a.uri}\0${a.methods.join('|')}\0${a.sourcePath}\0${a.startLine}`,
      `${b.uri}\0${b.methods.join('|')}\0${b.sourcePath}\0${b.startLine}`,
    ),
  );

  const gaps = [...input.gaps]
    .map((gap): InterchangeGap => ({
      kind: gap.kind,
      sourcePath: gap.sourcePath,
      ...(gap.startLine !== undefined
        ? {
            startLine: gap.startLine,
            endLine: gap.endLine ?? gap.startLine,
          }
        : {}),
      reason: gap.reason,
    }))
    .sort((a, b) =>
      codepointCompare(
        `${a.sourcePath}\0${a.kind}\0${a.startLine ?? 0}\0${a.reason}`,
        `${b.sourcePath}\0${b.kind}\0${b.startLine ?? 0}\0${b.reason}`,
      ),
    );

  const files = [...input.files]
    .map((file) => ({ path: file.path, sha256: file.sha256 }))
    .sort((a, b) => codepointCompare(a.path, b.path));

  return {
    schemaVersion: INTERCHANGE_SCHEMA_VERSION,
    packId: input.packId,
    language: input.language,
    ...(input.framework !== undefined ? { framework: input.framework } : {}),
    standIn: false,
    provenance: { repository: input.provenance.repository, commit: input.provenance.commit },
    routes,
    gaps,
    files,
  };
}

/** route:list action forms: `Controller@method`, bare invokable, `Closure`. */
function actionOf(row: LaravelRouteRow): { action?: string } {
  if (row.controller !== undefined && row.action === '__invoke') {
    return { action: row.controller };
  }
  if (row.controller !== undefined && row.action !== undefined) {
    return { action: `${row.controller}@${row.action}` };
  }
  if (row.action === 'closure') return { action: 'Closure' };
  return {};
}

function codepointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
