# Arxic rulepacks

Versioned ast-grep rule packs. Each pack directory carries a `pack.json` with
the framework it targets and the **normative** version range (DG-10, #254,
ADR-008 Decision 9):

| Pack           | Framework | Range                    |
| -------------- | --------- | ------------------------ |
| `nextjs-auth`  | `nextjs`  | `>=15 <17`               |
| `express-auth` | `express` | `>=4 <6`                 |
| `react`        | —         | placeholder, no pack yet |

A directory without a readable `pack.json` is not an installed pack; naming its
framework in `scope.frameworks` fails fast at config validation.

## Framework gating at a glance

1. **Detection (deterministic, evidence-anchored).** The framework and version
   are detected from the target repository's source evidence, strongest tier
   first:
   - `lockfile` — resolved versions from `pnpm-lock.yaml`, `package-lock.json`,
     `npm-shrinkwrap.json`, `yarn.lock` (v1), `composer.lock`.
   - `manifest` — declared dependency ranges from `package.json` /
     `composer.json`. Lower confidence by construction: a range accepts only
     when **every** version it can install lies inside the pack range (exact
     pins compare directly).
   - `imports` — framework package imports in tracked TypeScript sources;
     name-only corroboration, never a version.
2. **Enforcement (at rulepack selection time).**
   - inside the range → `ARXIC-RULES-FRAMEWORK-ACCEPTED` (observed), rules run.
   - outside the range → `ARXIC-RULES-FRAMEWORK-REJECTED` (blocked), zero rules
     run — this is what the 2026-08-16 campaign's silent Next 16.2.6-vs-
     `>=15 <16` acceptance used to be.
   - no pack provides the framework → `ARXIC-RULES-FRAMEWORK-UNKNOWN`
     (blocked), before any crawl.
   - no version evidence at all → `ARXIC-RULES-FRAMEWORK-UNDETECTED`
     (observed); rules run with the non-enforcement explicitly on record.
3. **Waivers (recorded operator decisions).** A waiver lives in the target
   repository as a committed `arxic.waivers.json`:

   ```json
   {
     "version": 1,
     "frameworkWaivers": [
       {
         "framework": "nextjs",
         "version": "16.2.6",
         "packVersionRange": ">=15 <16",
         "reason": "operator reviewed nextjs-auth rules against Next 16.2.6",
         "approvedBy": "anthonykewl20",
         "recordedAt": "2026-08-17T00:00:00.000Z"
       }
     ]
   }
   ```

   Semantics: a waiver applies only when its framework, **exact detected
   version**, and the pack's **current declared range** all match — bump the
   pack range and the waiver stops applying; detect a different version and it
   stops applying. A malformed or incomplete waivers file fails closed as
   `ARXIC-RULES-WAIVER-INVALID` (blocked) even when the run would otherwise be
   in range. A valid, applicable waiver emits
   `ARXIC-RULES-FRAMEWORK-WAIVED` (observed) naming the approving operator and
   reason, and the rules run.

## Range grammar

Pack ranges and manifest dependencies use the npm range grammar subset
implemented in `@arxic/ast-grep-adapter` (`framework-gate.ts`): comparators
(`>=`, `>`, `<=`, `<`, `=`), exact versions, `^`/`~` ranges (npm 0.x special
cases included), hyphen ranges, x-ranges (`16`, `16.2`, `16.x`, `*`), and
`||` unions. Prerelease versions satisfy a range only when a comparator on the
same major.minor.patch tuple carries a prerelease (npm rule — a canary build
never satisfies a release-only range; waive it explicitly if needed). Anything
outside the grammar fails closed.
