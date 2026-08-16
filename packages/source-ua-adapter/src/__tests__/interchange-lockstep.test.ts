import { describe, expect, it } from 'vitest';
import type {
  InterchangeGap as RealInterchangeGap,
  InterchangeRoute as RealInterchangeRoute,
  RouteInventoryInterchange as RealRouteInventoryInterchange,
} from '../../../domain-inventory-spike/src/interchange';
import { validateInterchange } from '../../../domain-inventory-spike/src/interchange';
import {
  INTERCHANGE_SCHEMA_VERSION,
  toRouteInventoryInterchange,
  type InterchangeGap,
  type InterchangeRoute,
  type RouteInventoryInterchange,
} from '../language-packs/interchange';
import type { LaravelGap, LaravelRouteRow } from '../language-packs/php/laravel-routes';

/**
 * LOCKSTEP GUARD (DG-05 review P2): the production pack's interchange types
 * are a MIRROR of the DG-02 contract
 * (`packages/domain-inventory-spike/src/interchange.ts`) — the pack must not
 * depend on the spike package at runtime (the spike dev-depends on THIS
 * package), so drift between the mirror and the real contract is possible
 * exactly where fields are optional and unvalidated. The real
 * `validateInterchange` cannot catch an unemitted optional field; TYPE-LEVEL
 * equality can.
 *
 * Approach: type-only imports (erased at runtime — no new dependency edge)
 * plus strict mutual-assignability assertions. `pnpm typecheck` / CI typecheck
 * covers `src/__tests__`, so any field added to (or removed from) the real
 * contract without a matching mirror change fails the build here, not in
 * production evidence.
 */

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

// The gap shape is the drift class the review found (estimatedRouteCount was
// missing): it must be EXACTLY the real contract's shape.
type GapLockstep = Expect<Equal<InterchangeGap, RealInterchangeGap>>;

// Route and document shapes lockstep too — same enforcement, zero cost.
type RouteLockstep = Expect<Equal<InterchangeRoute, RealInterchangeRoute>>;
type DocumentLockstep = Expect<Equal<RouteInventoryInterchange, RealRouteInventoryInterchange>>;
void ({} as GapLockstep);
void ({} as RouteLockstep);
void ({} as DocumentLockstep);

describe('interchange mirror lockstep (DG-05 review P2)', () => {
  it('emits a gap with estimatedRouteCount and the real validator accepts it', async () => {
    // Exercised, not merely declared: a literal-include gap whose estimate
    // comes from parsing the included file (engine path under test in
    // laravel-routes.test.ts), translated through the mirror, validated by
    // the REAL DG-02 validator.
    const routes: LaravelRouteRow[] = [
      {
        method: 'GET',
        uri: '/songs',
        action: 'closure',
        kind: 'static',
        sourcePath: 'routes/api.php',
        startLine: 5,
        endLine: 5,
      },
    ];
    const gaps: LaravelGap[] = [
      {
        kind: 'unresolved-file',
        sourcePath: 'app/Providers/RouteServiceProvider.php',
        startLine: 9,
        endLine: 11,
        reason: 'includes route file routes/api.php (including group context not applied)',
        estimatedRouteCount: 1,
      },
    ];
    const interchange = toRouteInventoryInterchange({
      packId: 'arxic-langpack-php@1.0.0',
      language: 'php',
      framework: 'laravel',
      provenance: { repository: 'file:///tmp/lockstep', commit: 'a'.repeat(40) },
      routes,
      gaps,
      files: [{ path: 'routes/api.php', sha256: 'b'.repeat(64) }],
    });

    expect(interchange.schemaVersion).toBe(INTERCHANGE_SCHEMA_VERSION);
    expect(interchange.gaps[0]).toMatchObject({ estimatedRouteCount: 1 });
    expect(validateInterchange(interchange)).toMatchObject({ ok: true });
  });

  it('keeps gap kinds in the real contract vocabulary', () => {
    // Runtime half of the lockstep: every kind the engine can emit is a kind
    // the real validator accepts (belt to the compile-time suspenders —
    // catches renames that slip through structural typing via strings).
    const kinds: LaravelGap['kind'][] = [
      'dynamic-registration',
      'parse-error',
      'unresolved-file',
      'conditional-block',
      'unsupported',
    ];
    const base = {
      schemaVersion: INTERCHANGE_SCHEMA_VERSION,
      packId: 'arxic-langpack-php@1.0.0',
      language: 'php',
      standIn: false,
      provenance: { repository: 'file:///tmp/lockstep', commit: 'a'.repeat(40) },
      routes: [],
      files: [],
    };
    for (const kind of kinds) {
      const interchange = toRouteInventoryInterchange({
        packId: base.packId,
        language: base.language,
        provenance: base.provenance,
        routes: [],
        gaps: [{ kind, sourcePath: 'routes/api.php', reason: `probe ${kind}` }],
        files: [],
      });
      const validation = validateInterchange(interchange);
      expect(validation, kind).toMatchObject({ ok: true });
    }
  });
});
