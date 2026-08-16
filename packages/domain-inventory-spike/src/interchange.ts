import type { Diagnostic } from '@arxic/contracts';
import { ARXIC_INVENTORY_INTERCHANGE_INVALID, inventoryDiagnostic } from './diagnostics';

/**
 * INTERCHANGE FORMAT v1 — the documented contract between a (future) DG-01/DG-05
 * PHP language pack and the Domain Inventory fusion (issue #246 deliverable 1).
 *
 * Design anchor: Laravel's own `route:list --json` emits, per route,
 * `{ method: "GET|HEAD", uri, name, action, middleware: [...] }`
 * (laravel/framework src/Illuminate/Foundation/Console/RouteListCommand.php,
 * getRouteInformation()/asJson(), tag v13.25.0). The interchange is a strict
 * superset: it adds per-route line anchors (path + startLine/endLine), the
 * per-file blob SHA-256 map, explicit `conditional` marking for routes
 * registered inside runtime-evaluated `if` blocks, and a `gaps` array so a
 * producer can account for files it could NOT enumerate (dynamic registration,
 * parse errors) instead of silently omitting them.
 *
 * Compatibility: a producer may emit the route:list `method` pipe string
 * ("GET|HEAD") instead of `methods`; the validator accepts both and the
 * canonical internal form is `methods`.
 */

export const INTERCHANGE_SCHEMA_VERSION = 1;

export const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

export type InterchangeRoute = {
  /** Canonical HTTP methods (uppercase). Pipe-string `method` is accepted as input. */
  methods: HttpMethod[];
  /** Absolute (prefix-composed) URI with `{param}` / `{param?}` placeholders. */
  uri: string;
  name?: string;
  action?: string;
  middleware?: string[];
  sourcePath: string;
  startLine: number;
  endLine: number;
  /** Route is registered inside an `if (...)` block — may not exist at runtime. */
  conditional?: boolean;
};

export type InterchangeGapKind =
  'dynamic-registration' | 'parse-error' | 'unresolved-file' | 'conditional-block' | 'unsupported';

export type InterchangeGap = {
  kind: InterchangeGapKind;
  sourcePath: string;
  startLine?: number;
  endLine?: number;
  reason: string;
  estimatedRouteCount?: number;
};

export type RouteInventoryInterchange = {
  schemaVersion: typeof INTERCHANGE_SCHEMA_VERSION;
  /** Pack identity, `name@version`. Non-stand-in packs must be versioned. */
  packId: string;
  language: string;
  framework?: string;
  /** REQUIRED true for the DG-02 stand-in enumerator; DG-01 packs emit false. */
  standIn: boolean;
  provenance: { repository: string; commit: string };
  routes: InterchangeRoute[];
  gaps: InterchangeGap[];
  files: Array<{ path: string; sha256: string }>;
};

const PACK_ID = /^[a-z0-9][a-z0-9._-]*@[0-9][^@]*$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

export type InterchangeValidation =
  { ok: true; value: RouteInventoryInterchange } | { ok: false; diagnostics: Diagnostic[] };

export function validateInterchange(input: unknown): InterchangeValidation {
  const diagnostics: Diagnostic[] = [];
  const reject = (subject: string, message: string) => {
    diagnostics.push(inventoryDiagnostic(ARXIC_INVENTORY_INTERCHANGE_INVALID, subject, message));
  };
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    reject('interchange', 'Interchange must be a JSON object.');
    return { ok: false, diagnostics };
  }
  const record = input as Record<string, unknown>;
  if (record.schemaVersion !== INTERCHANGE_SCHEMA_VERSION) {
    reject('interchange.schemaVersion', `Expected ${INTERCHANGE_SCHEMA_VERSION}.`);
  }
  if (typeof record.packId !== 'string' || !PACK_ID.test(record.packId)) {
    reject('interchange.packId', 'packId must be name@version.');
  }
  if (typeof record.language !== 'string' || record.language.length === 0) {
    reject('interchange.language', 'language must be a non-empty string.');
  }
  if (record.framework !== undefined && typeof record.framework !== 'string') {
    reject('interchange.framework', 'framework must be a string when present.');
  }
  if (typeof record.standIn !== 'boolean') {
    reject('interchange.standIn', 'standIn must be an explicit boolean (no unmarked stand-ins).');
  }
  const provenance = record.provenance as Record<string, unknown> | undefined;
  if (
    typeof provenance !== 'object' ||
    provenance === null ||
    typeof provenance.repository !== 'string' ||
    !/^[0-9a-f]{40}$/u.test(String(provenance.commit))
  ) {
    reject('interchange.provenance', 'provenance must carry repository and a 40-hex commit.');
  }

  const routes = Array.isArray(record.routes) ? record.routes : null;
  if (!routes) {
    reject('interchange.routes', 'routes must be an array.');
  } else {
    routes.forEach((route, index) => {
      const subject = `interchange.routes[${index}]`;
      if (typeof route !== 'object' || route === null) {
        reject(subject, 'Route must be an object.');
        return;
      }
      const row = route as Record<string, unknown>;
      const methods = normalizeMethods(row.methods, row.method);
      if (!methods) reject(subject, 'Route needs methods[] or a route:list method pipe string.');
      if (typeof row.uri !== 'string' || !row.uri.startsWith('/')) {
        reject(`${subject}.uri`, 'uri must be an absolute path starting with /.');
      }
      for (const field of ['name', 'action'] as const) {
        if (row[field] !== undefined && typeof row[field] !== 'string') {
          reject(`${subject}.${field}`, `${field} must be a string when present.`);
        }
      }
      if (
        row.middleware !== undefined &&
        (!Array.isArray(row.middleware) ||
          row.middleware.some((entry) => typeof entry !== 'string'))
      ) {
        reject(`${subject}.middleware`, 'middleware must be a string array when present.');
      }
      if (typeof row.sourcePath !== 'string' || row.sourcePath.length === 0) {
        reject(`${subject}.sourcePath`, 'sourcePath is required for line-anchored evidence.');
      }
      const startLine = row.startLine;
      const endLine = row.endLine;
      if (
        typeof startLine !== 'number' ||
        typeof endLine !== 'number' ||
        !Number.isInteger(startLine) ||
        !Number.isInteger(endLine) ||
        startLine < 1 ||
        startLine > endLine
      ) {
        reject(
          `${subject}.startLine/endLine`,
          'Line anchors must be integers with 1 ≤ start ≤ end.',
        );
      }
      if (row.conditional !== undefined && typeof row.conditional !== 'boolean') {
        reject(`${subject}.conditional`, 'conditional must be boolean when present.');
      }
    });
  }

  const gaps = Array.isArray(record.gaps) ? record.gaps : null;
  if (!gaps) {
    reject('interchange.gaps', 'gaps must be an array (possibly empty — never omitted).');
  } else {
    const kinds = new Set<string>([
      'dynamic-registration',
      'parse-error',
      'unresolved-file',
      'conditional-block',
      'unsupported',
    ]);
    gaps.forEach((gap, index) => {
      const subject = `interchange.gaps[${index}]`;
      if (typeof gap !== 'object' || gap === null) {
        reject(subject, 'Gap must be an object.');
        return;
      }
      const row = gap as Record<string, unknown>;
      if (typeof row.kind !== 'string' || !kinds.has(row.kind)) {
        reject(`${subject}.kind`, 'Unknown gap kind.');
      }
      if (typeof row.sourcePath !== 'string' || row.sourcePath.length === 0) {
        reject(`${subject}.sourcePath`, 'Gap needs a sourcePath.');
      }
      if (typeof row.reason !== 'string' || row.reason.length === 0) {
        reject(`${subject}.reason`, 'Gap needs a non-empty reason (no silent drops).');
      }
    });
  }

  const files = Array.isArray(record.files) ? record.files : null;
  if (!files) {
    reject('interchange.files', 'files must be an array.');
  } else {
    files.forEach((file, index) => {
      const row = file as Record<string, unknown>;
      if (typeof row?.path !== 'string' || typeof row.sha256 !== 'string') {
        reject(`interchange.files[${index}]`, 'File entries need path and sha256.');
      } else if (!SHA256.test(row.sha256)) {
        reject(`interchange.files[${index}].sha256`, 'sha256 must be 64 hex chars.');
      }
    });
  }

  if (diagnostics.length > 0) return { ok: false, diagnostics };

  const canonical = input as RouteInventoryInterchange;
  const value: RouteInventoryInterchange = {
    ...canonical,
    routes: canonical.routes.map((route) => ({
      ...route,
      methods: normalizeMethods(
        (route as { methods?: unknown }).methods,
        (route as { method?: unknown }).method,
      ) as HttpMethod[],
    })),
  };
  return { ok: true, value };
}

function normalizeMethods(methods: unknown, pipe: unknown): string[] | null {
  const fromArray = Array.isArray(methods)
    ? methods.every((m) => typeof m === 'string' && (HTTP_METHODS as readonly string[]).includes(m))
      ? [...(methods as string[])]
      : null
    : undefined;
  const fromPipe =
    typeof pipe === 'string' && pipe.length > 0
      ? pipe
          .split('|')
          .map((m) => m.trim())
          .every((m) => (HTTP_METHODS as readonly string[]).includes(m))
        ? pipe.split('|').map((m) => m.trim())
        : null
      : undefined;
  const chosen = fromArray ?? fromPipe;
  if (!chosen || chosen.length === 0) return null;
  return chosen;
}
