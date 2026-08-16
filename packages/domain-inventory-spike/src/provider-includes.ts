import type { Diagnostic } from '@arxic/contracts';
import {
  ARXIC_INVENTORY_PROVIDER_INCLUDE_RESOLVED,
  ARXIC_INVENTORY_PROVIDER_INCLUDE_UNRESOLVED,
  inventoryDiagnostic,
} from './diagnostics';
import type { InterchangeGap, RouteInventoryInterchange } from './interchange';

/**
 * PROVIDER-INCLUDE PREFIX RESOLUTION — the two-pass providers→routes
 * composition DG-05 had to defer (#249 slice note §6: "prefixes are still not
 * applied to included files (BookStack api rows unprefixed; 9 URI collisions
 * vs web rows stand). Requires provider-first scanning; DG-06/#250").
 *
 * Why it lives HERE and not in the pack (#250 decision, documented): the
 * per-file scan is structurally unable to compose cross-file context — a
 * provider includes a route file inside `Route::group(['prefix' => 'api'],
 * …)`, and the included file is scanned standalone. The Domain Inventory
 * fusion layer is the first place where BOTH the include gap (with the
 * provider path + line anchor) and the included file's routes are visible,
 * so the second pass is a fusion-layer concern. The interchange contract is
 * consumed unmodified; this resolver derives a corrected interchange plus a
 * structured resolution record.
 *
 * Deterministic, read-only, and never fabricating: a gap that cannot be
 * resolved (provider unavailable, dynamic include path, unparseable context)
 * is returned UNRESOLVED and stays a visible structured gap in the inventory.
 */

/** A successfully composed include context. */
export type ProviderIncludeResolution = {
  /** The file containing the include statement (the gap's sourcePath). */
  providerPath: string;
  /** 1-based line of the include statement (the gap's anchor). */
  includeLine: number;
  /** The literal included route file named by the gap reason. */
  includedFile: string;
  /** Composed prefix segments from the ENCLOSING group context, outer→inner. */
  prefixSegments: string[];
  /** How many interchange routes had the prefix applied. */
  appliedRoutes: number;
  /** The gap's honest estimate of the routes behind the include, when present. */
  estimatedRouteCount?: number;
};

export type UnresolvedProviderInclude = {
  /** Index into the input `interchanges` array. */
  interchangeIndex: number;
  gap: InterchangeGap;
  reason: string;
};

export type ProviderIncludeContext = {
  /** Derived interchanges (prefix applied; resolved include gaps accounted). Input order preserved. */
  interchanges: RouteInventoryInterchange[];
  /** Successful compositions, deterministically ordered. */
  resolutions: readonly ProviderIncludeResolution[];
  /** Includes that stayed unresolved — each remains a visible gap. */
  unresolved: readonly UnresolvedProviderInclude[];
  /** Structured observations (severity observed; never blocking). */
  diagnostics: readonly Diagnostic[];
};

/** DG-05's literal-include reason shape: "…includes route file <path> (…)". */
const LITERAL_INCLUDE_REASON = /includes route file (?<path>\S+) \(/u;
/** The Route::group file-include reason shape (same literal path payload). */
const GROUP_INCLUDE_REASON = /route file (?<path>\S+) is included via Route::group/u;
const DYNAMIC_INCLUDE_REASON = 'includes a route file whose path is computed at runtime';

/** Look-back window for the enclosing `Route::group(` above the include. */
const GROUP_LOOKBACK_LINES = 30;

export async function resolveProviderIncludes(input: {
  interchanges: readonly RouteInventoryInterchange[];
  /** Root-relative UTF-8 reader; returning null means "unavailable" (sad path). */
  readUtf8: (path: string) => Promise<string | null>;
}): Promise<ProviderIncludeContext> {
  const resolutions: ProviderIncludeResolution[] = [];
  const unresolved: UnresolvedProviderInclude[] = [];
  const diagnostics: Diagnostic[] = [];
  /** provider → included file → resolution, to keep applications first-wins. */
  const applied = new Map<string, ProviderIncludeResolution>();

  const interchanges = await Promise.all(
    input.interchanges.map((interchange, interchangeIndex) =>
      resolveOne(interchange, interchangeIndex),
    ),
  );

  const orderedResolutions = [...resolutions].sort(
    (left, right) =>
      codepoint(left.providerPath, right.providerPath) || left.includeLine - right.includeLine,
  );
  for (const resolution of orderedResolutions) {
    diagnostics.push(
      inventoryDiagnostic(
        ARXIC_INVENTORY_PROVIDER_INCLUDE_RESOLVED,
        `${resolution.providerPath}:${resolution.includeLine}`,
        `applied prefix [${resolution.prefixSegments.join('/')}] to ${resolution.appliedRoutes} route(s) of ${resolution.includedFile} (include context composed by the fusion layer)`,
      ),
    );
  }
  for (const miss of unresolved) {
    diagnostics.push(
      inventoryDiagnostic(
        ARXIC_INVENTORY_PROVIDER_INCLUDE_UNRESOLVED,
        `${miss.gap.sourcePath}:${miss.gap.startLine ?? 0}`,
        `include gap remains visible: ${miss.reason}`,
      ),
    );
  }

  return {
    interchanges,
    resolutions: orderedResolutions,
    unresolved: unresolved.sort(
      (left, right) =>
        codepoint(left.gap.sourcePath, right.gap.sourcePath) ||
        (left.gap.startLine ?? 0) - (right.gap.startLine ?? 0),
    ),
    diagnostics,
  };

  async function resolveOne(
    interchange: RouteInventoryInterchange,
    interchangeIndex: number,
  ): Promise<RouteInventoryInterchange> {
    const resolvedGaps = new Set<InterchangeGap>();
    // Resolutions created for THIS interchange only — prefix application must
    // never leak a pack's provider context into another pack's routes.
    const createdHere: ProviderIncludeResolution[] = [];
    for (const gap of interchange.gaps) {
      if (gap.kind !== 'unresolved-file') continue;
      if (gap.reason.includes(DYNAMIC_INCLUDE_REASON)) {
        unresolved.push({
          interchangeIndex,
          gap,
          reason: 'no literal included file in the gap reason (path computed at runtime)',
        });
        continue;
      }
      const includedFile =
        LITERAL_INCLUDE_REASON.exec(gap.reason)?.groups?.path ??
        GROUP_INCLUDE_REASON.exec(gap.reason)?.groups?.path;
      if (!includedFile) {
        unresolved.push({
          interchangeIndex,
          gap,
          reason: 'no literal included file in the gap reason',
        });
        continue;
      }
      const providerText = await input.readUtf8(gap.sourcePath);
      if (providerText === null) {
        unresolved.push({
          interchangeIndex,
          gap,
          reason: 'provider file unavailable to the fusion layer',
        });
        continue;
      }
      const prefix = extractEnclosingPrefix(providerText, gap.startLine, gap.endLine);
      if (!prefix.ok) {
        unresolved.push({ interchangeIndex, gap, reason: prefix.reason });
        continue;
      }
      const first = applied.get(includedFile);
      if (first && first.providerPath !== gap.sourcePath) {
        unresolved.push({
          interchangeIndex,
          gap,
          reason: `file included by multiple providers (first application at ${first.providerPath}:${first.includeLine} wins)`,
        });
        continue;
      }
      const resolution: ProviderIncludeResolution = {
        providerPath: gap.sourcePath,
        includeLine: gap.startLine ?? 0,
        includedFile,
        prefixSegments: prefix.prefixSegments,
        appliedRoutes: 0,
        ...(gap.estimatedRouteCount !== undefined
          ? { estimatedRouteCount: gap.estimatedRouteCount }
          : {}),
      };
      applied.set(includedFile, resolution);
      resolutions.push(resolution);
      createdHere.push(resolution);
      resolvedGaps.add(gap);
    }

    if (resolvedGaps.size === 0) return interchange;
    const prefixOf = new Map<string, string[]>();
    for (const resolution of createdHere) {
      if (!prefixOf.has(resolution.includedFile)) {
        prefixOf.set(resolution.includedFile, resolution.prefixSegments);
      }
    }
    const routes = interchange.routes
      .map((route) => {
        const prefix = prefixOf.get(route.sourcePath);
        return prefix === undefined ? route : { ...route, uri: applyPrefix(prefix, route.uri) };
      })
      .sort((left, right) =>
        codepoint(
          `${left.uri}\0${left.methods.join('|')}\0${left.sourcePath}\0${left.startLine}`,
          `${right.uri}\0${right.methods.join('|')}\0${right.sourcePath}\0${right.startLine}`,
        ),
      );
    for (const resolution of createdHere) {
      resolution.appliedRoutes = interchange.routes.filter(
        (route) => route.sourcePath === resolution.includedFile,
      ).length;
    }
    const gaps = interchange.gaps
      .filter((gap) => !resolvedGaps.has(gap))
      .sort((left, right) =>
        codepoint(
          `${left.sourcePath}\0${left.kind}\0${left.startLine ?? 0}\0${left.reason}`,
          `${right.sourcePath}\0${right.kind}\0${right.startLine ?? 0}\0${right.reason}`,
        ),
      );
    return { ...interchange, routes, gaps };
  }
}

/**
 * Extract the prefix context of the `Route::group(...)` that encloses the
 * anchored include statement. Returns `{ ok: false }` (with a reason) when no
 * group context can be proven — the conservative path: an unproven context is
 * NEVER defaulted to empty, because a wrongly-unprefixed file collides with
 * the web surface (exactly the BookStack defect being fixed).
 */
function extractEnclosingPrefix(
  providerText: string,
  startLine: number | undefined,
  endLine: number | undefined,
): { ok: true; prefixSegments: string[] } | { ok: false; reason: string } {
  if (startLine === undefined) {
    return { ok: false, reason: 'gap carries no line anchor' };
  }
  const lines = providerText.split(/\r?\n/u);
  const includeIndex = startLine - 1;
  if (includeIndex < 0 || includeIndex >= lines.length) {
    return { ok: false, reason: 'gap anchor is outside the provider file' };
  }
  let groupIndex = -1;
  const floor = Math.max(0, includeIndex - GROUP_LOOKBACK_LINES);
  for (let index = includeIndex; index >= floor; index -= 1) {
    if (
      /Route::\s*group\s*\(/u.test(lines[index] ?? '') ||
      /->\s*group\s*\(/u.test(lines[index] ?? '')
    ) {
      groupIndex = index;
      break;
    }
  }
  if (groupIndex === -1) {
    return {
      ok: false,
      reason:
        'no enclosing Route::group near the include anchor (context unproven, prefix not defaulted)',
    };
  }
  const statementEnd = Math.min(lines.length - 1, (endLine ?? startLine) - 1);
  const statement = lines.slice(groupIndex, Math.max(statementEnd, includeIndex) + 1).join('\n');
  const segments: string[] = [];
  // Chained builders BEFORE the registrar: Route::prefix('a')->prefix('b')->group(…)
  const chain =
    /(?:Route::)?->prefix\(\s*(['"])((?:(?!\1)[^\\])*)\1\s*\)|Route::prefix\(\s*(['"])((?:(?!\3)[^\\])*)\3\s*\)/gu;
  for (const match of statement.matchAll(chain)) {
    const literal = match[2] ?? match[4];
    if (literal !== undefined) segments.push(...splitSegments(literal));
  }
  // Array attributes: Route::group(['prefix' => 'api', …], …)
  const arrayAttrs =
    /['"]prefix['"]\s*=>\s*(?:(['"])((?:(?!\1)[^\\])*)\1|\[((?:\s*['"][^'"]*['"]\s*,?)+)\s*\])/u;
  const attrs = arrayAttrs.exec(statement);
  if (attrs) {
    if (attrs[2] !== undefined) segments.push(...splitSegments(attrs[2]));
    if (attrs[3] !== undefined) {
      for (const element of attrs[3].matchAll(/['"]([^'"]*)['"]/gu)) {
        segments.push(...splitSegments(element[1] ?? ''));
      }
    }
  }
  return { ok: true, prefixSegments: segments };
}

/** Laravel prefix semantics: segments joined onto the URI path; `/` → prefix. */
function applyPrefix(prefix: readonly string[], uri: string): string {
  const uriSegments = uri.split('/').filter((segment) => segment.length > 0);
  const segments = [...prefix.filter((segment) => segment.length > 0), ...uriSegments];
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

function splitSegments(literal: string): string[] {
  return literal
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function codepoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
