# DG-12 exit campaigns — design record (STAGED, not launched)

| Field         | Value                                                                                                                                                                                                                                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Issue         | #256 (DG-12 exit gate) — `refs #256`; this record stages the campaigns, it does not run them                                                                                                                                                                                                                                                                                         |
| Branch / HEAD | `issue/256` @ `bd3bc0a` (worktree `.worktrees/DG-12`)                                                                                                                                                                                                                                                                                                                                |
| Recorded      | 2026-08-21 (UTC)                                                                                                                                                                                                                                                                                                                                                                     |
| State         | **STAGED** — design + templates + ledger copies committed; NO campaigns launched, ZERO model spend, ZERO containers booted                                                                                                                                                                                                                                                           |
| Secrets       | This record and every staged file contain NO credential values. The directus admin password is referenced only as "the BOOT-PROCEDURES directus `ADMIN_PASSWORD`"; the koel first-admin credential is referenced only as the upstream-public constants `User::FIRST_ADMIN_EMAIL` / `User::FIRST_ADMIN_PASSWORD` (clone at pin). Credentials enter only via launcher env at run time. |

Investigation below is read-only: repository sources at HEAD `bd3bc0a`, the DG-11
evidence set, and the pristine clones under `/home/soultransit/devtony/thirdparty-dg/`
(koel @ `dfec91ff290509c622ff7cf392fb5e506841ee2b`, directus @
`cb846b6a1ddc4811359bc52b74bb31a42eab33db`). Nothing was executed against the
clones, the apps, or any model endpoint.

---

## 1. Investigation findings

### 1.1 Runner mechanics — path derivation, run-ids, ceiling rule (P2-7)

**Config template path is DERIVED from `ARXIC_DG11_EVIDENCE_DIR`, not fixed to DG-11.**
`packages/intent-proposal-spike/scripts/dg11-run-validation.ts:1018-1023`:

```ts
const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..');
const evidenceDir = resolve(repoRoot, process.env.ARXIC_DG11_EVIDENCE_DIR ?? 'docs/evidence/DG-11');
const targetDir = join(evidenceDir, target);
```

`resolve(repoRoot, <absolute>)` yields the absolute path unchanged, so
`ARXIC_DG11_EVIDENCE_DIR=<abs>/docs/evidence/DG-12` relocates everything. All
record/ledger paths derive from `targetDir`:

- config template — `dg11-run-validation.ts:1164`:
  `const configTemplatePath = join(context.targetDir, 'arxic.yaml');`
- spend ledger — `:1032`: `const ledgerPath = join(targetDir, 'spend-ledger.json');`
- run records — `:1163`: `const outDir = join(context.targetDir, 'runs');` (record at
  `runs/<runId>.json` `:1378`; run artifacts at `runs/<runId>/artifacts/*`)
- refusals — `:1059`: `join(targetDir, 'refusals', `${runId}-${refusal.reason}.json`)`

**Conclusion: setting `ARXIC_DG11_EVIDENCE_DIR` to the DG-12 directory relocates
template + ledger + runs + refusals cleanly. Nothing else keys on DG-11.**

**Run-id / env naming** (`:1033-1043`): default `dg11-<target>-<utc stamp>`;
`ARXIC_DG11_RUN_ID` overrides; the id must match
`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` (`:114`, checked before any path use).
`directus-dg12-run1`, `directus-dg12-run2`, `koel-dg12-run1`, `koel-dg12-run2`
all match.

**Ledger ceiling vs `ARXIC_DG11_CEILING_USD` — the P2-7 rule is enforced** at
`:473-496`: when a ledger EXISTS and the env ceiling is set and they differ
beyond 1e-9, preflight refuses with reason `ceiling-mismatch`, quoting both
values, and zero spend occurs. Unset env ⇒ the ledger's ceiling is
authoritative. So the copied ledgers (ceiling `1`) REQUIRE
`ARXIC_DG11_CEILING_USD=1.00` at launch (or leaving it unset; the design pins
`1.00` explicitly so the env/ledger match rule is exercised, per DG-11 README
"ledger ceiling once the ledger exists"). Preflight order is fail-closed:
ledger integrity → ceiling agreement → strictly-positive prices → budget
headroom → credentials (`:430-558`).

Other carried facts: ratified pins hard-asserted against the clone HEAD at
`:1139` (`DG11_TARGET_PINS` `:97-100` — same pins as DG-12 targets); row
estimate defaults directus 272 / koel 306 (`:92-95`, overridable via
`ARXIC_DG11_ESTIMATED_ROWS`); the runner rewrites ONLY three placeholders in the
template (`:1196-1200`): `http://127.0.0.1:DG11-PROXY-PORT`, `DG11-CLONE-PATH`,
`DG11-CLONE-COMMIT`.

### 1.2 Fixture / persona config shape (validator + docs + both executor lanes)

**The YAML accepts NO credentials.** `apps/cli/src/config/validate.ts:12-20`
recognizes exactly `version, source, scope, target, policy, fixtures, models`;
`fixtures` accepts three OPTIONAL STRINGS (`:138-145`):

```ts
const fixtures = objectField(input, 'fixtures', diagnostics);
const inbox = optionalString(fixtures?.inbox, 'config.fixtures.inbox', diagnostics);
const otp = optionalString(fixtures?.otp, 'config.fixtures.otp', diagnostics);
const personaProvisioner = optionalString(
  fixtures?.personaProvisioner,
  'config.fixtures.personaProvisioner',
  diagnostics,
);
```

`docs/configuration.md:41-42` shows the canonical wiring
(`fixtures: { personaProvisioner: app-seed-api }`) and `:103-107` states all
fixture fields are optional provider strings; `:113-119` confirms the model
endpoint/credential live in env, never in the YAML. The exact YAML shape the
validator accepts for a registered-user credential run:

```yaml
scope:
  personas: [anonymous, registered-user]
fixtures:
  personaProvisioner: <provider-name-string> # optional label; not a credential
```

**The credential channel is env-only** — `apps/cli/src/local-executor.ts:353-359`:

```ts
function configuredPersona(): VerificationPersona | undefined {
  const email = process.env.ARXIC_INPUT_PERSONA_EMAIL?.trim();
  const password = process.env.ARXIC_INPUT_PERSONA_PASSWORD;
  if (!email || !password) return undefined;
  const newPassword = process.env.ARXIC_INPUT_PERSONA_NEWPASSWORD;
  return { email, password, ...(newPassword ? { newPassword } : {}) };
}
```

This answers the step-4 question beyond env-var indirection: the config cannot
hold literal credentials at all, so the launcher does not substitute anything
into the temp config — it exports `ARXIC_INPUT_PERSONA_EMAIL` /
`ARXIC_INPUT_PERSONA_PASSWORD` before invoking the runner (the runner calls
`runCli` in-process, `:1207-1213`, so launcher env reaches the CLI directly).

**How fixtures integrate with personas and stages 7/8/10 (leased-fixtures-only):**

- `scope.personas` flows to the orchestrator as advisory metadata
  (`toOrchestratorInput`, local-executor.ts:106).
- Stage 7 (fixture prep) — local-executor.ts:207-224: proposal candidates that
  drive a form get a PERSONA lease; `:217`
  `await resetAndSeedFixtures(request.config.target.origin, persona);` runs
  BEFORE leasing; without a persona the step is policy-skipped honestly
  (`provisioned: true`, no leases) and compile later blocks OBSERVATION-MISSING.
  The lease itself (`personaLeaseFor`, `:232-241`) authorizes the stage-8
  exploration's reversible form submit under the policy engine.
- Stage 8 (exploration) — persona values are transient in-memory input values
  (`personaInputValues`, `:249-254`: `persona.email` / `persona.password` /
  `persona.newpassword`), never in artifacts or diagnostics.
- Stage 10 (verification) — `PlaywrightVerifier` is constructed WITHOUT a custom
  `resetAndSeed` hook (local-executor.ts:120-132), so the verifier's own
  `#reset` runs before EVERY verification pass — verifier.ts:269-270 calls it,
  and `:406-410` dispatches: custom hook, else (no persona ⇒ throw), else
  `resetAndSeedFixtures(origin, persona)`.
- **`resetAndSeedFixtures` requires target-side arxic endpoints** —
  `packages/verifier/src/reset.ts:20-33` POSTs `/__arxic/reset` then
  `/__arxic/seed` (body: `{ personaId: 'arxic-verifier-user', ...persona }`)
  against the TARGET ORIGIN; failures raise `FixtureResetError` ⇒
  `ARXIC_VERIFY_BLOCKED_FIXTURE`. The reference app implements these as its own
  routes (`test-fixtures/reference-auth-app/next.config.mjs:7-8` rewrites
  `/__arxic/reset|seed` → `/api/__arxic/*`). **Vanilla third-party targets
  (directus, koel) do not have them** — the attestation-front proxy forwards
  non-well-known paths to the app (dg11-run-validation.ts:894-919), which 404s.
- Replay env: the verifier injects the persona into the Playwright suite env as
  `ARXIC_INPUT_PERSONA_*` (`personaEnvironment`, verifier.ts:474-482) and uses
  all persona values as forbidden substrings for artifact redaction
  (`personaForbiddenSubstrings`, :484-488).
- The WORKER lane is identical: `apps/worker/src/main.ts:209` calls the same
  `resetAndSeedFixtures(spec.config.target.origin, persona)`; the
  `personaProvisioner` spec field (apps/worker/src/run-spec.ts:108) is never
  read to provision anything.

**Consequence (candidate FINDING F-A below): wiring the persona env is
necessary but NOT sufficient on the current product — any persona-configured
campaign against a vanilla third-party target fails the reset/seed calls
(stage-7 `prepareFixtures` throws `FixtureResetError`; stage-10 blocks with
`ARXIC_VERIFY_BLOCKED_FIXTURE`), and any persona-UNconfigured campaign blocks
stage 10 with zero verification runs — exactly what DG-11 recorded
(FINDING 5358390733 item 1: both campaigns ended stage 10 with `runs: []`).**

### 1.3 Koel admin seeding at pin `dfec91ff` (clone, read-only)

- `composer.json:123`: `"koel:init": "@php scripts/koel-init.php"`; the script
  (koel/scripts/koel-init.php) runs `composer install` then
  `php artisan koel:init --ansi <args>` — call artisan DIRECTLY to skip the
  redundant composer pass.
- `app/Console/Commands/InitCommand.php:35`:
  `koel:init {--no-assets : Do not compile front-end assets} {--no-scheduler : Do not install scheduler}`
  plus Laravel's global `--no-interaction`.
- Non-interactive flow (handle, `:39-78`): clear caches → ensure `.env` (exists
  — skip) → app key (exists — retrieve) → database connect (bounded 10 attempts
  against the existing `.env`; the rehearsal DB at `/data/koel.sqlite` is
  already migrated, so this succeeds immediately) → `migrate --force` (no-op) →
  **`maybeSeedDatabase` `:207-217`: if `User::count() == 0` →
  `getOrCreateFirstAdmin()` + `db:seed --force`** → `storage:link --force`
  (target `public/storage` is gitignored — koel/.gitignore:94; porcelain stays
  clean) → legacy-image migration (no-op) → media path from env file in
  no-interaction mode (`:388-396`) → assets SKIPPED by `--no-assets` →
  scheduler SKIPPED by `--no-scheduler` (`:413-419`).
- First admin = upstream-public constants: `app/Repositories/UserRepository.php:18-37`
  `getOrCreateFirstAdmin()` creates the admin from `User::FIRST_ADMIN_NAME /
FIRST_ADMIN_EMAIL / FIRST_ADMIN_PASSWORD` (`app/Models/User.php:104-106`) —
  values committed in koel's own public source at the pin. Idempotent:
  `firstOr` returns the existing admin when one exists.
- **No HTTP setup endpoint exists at this pin** — `routes/` (api.base.php,
  web.base.php) contains no setup/initialization route; the first-visit screen
  the BOOT-PROCEDURES notes is the SPA shell, and the deterministic path IS the
  artisan command. SAFEST deterministic seeding (preferred over any HTTP flow):

  ```bash
  cd /home/soultransit/devtony/thirdparty-dg/koel
  docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp \
    -v "$PWD":/var/www/koel -v "$PWD/../koel-data":/data -w /var/www/koel \
    koel-php83:rehearsal php artisan koel:init --no-interaction --no-assets --no-scheduler
  ```

  Admin credentials then live in `koel-data/koel.sqlite` OUTSIDE the clone
  (BOOT-PROCEDURES layout notes), so seeding does not dirty the pinned
  worktree. The persona email/password for the launcher are read at run time
  from the clone constants (§4.2) — never committed.

### 1.4 Directus admin fixture (BOOT-PROCEDURES)

`/home/soultransit/devtony/thirdparty-dg/BOOT-PROCEDURES.md` (directus env
block) defines `ADMIN_EMAIL` and `ADMIN_PASSWORD` (values read from that file
at launch time; the password value is referred to only as "the BOOT-PROCEDURES
directus `ADMIN_PASSWORD`" and never appears in any committed file); the
one-time prep ALREADY ran
`node api/dist/cli/run.js bootstrap` with those env vars, creating the admin in
`directus-data/data.db` (outside the clone). The registered-user fixture is
therefore: persona email = the BOOT-PROCEDURES directus `ADMIN_EMAIL`, persona
password = the BOOT-PROCEDURES directus `ADMIN_PASSWORD`, both read from the
file at launch time by the launcher (§4.1). Since the arxic config holds no
credential fields at all (§1.2), no temp-config env substitution is needed —
the launcher exports `ARXIC_INPUT_PERSONA_*` only.

### 1.5 SURFACE-005 (`__name` crawl anomaly) mitigation options

- `apps/cli` HAS a built entry: `package.json` `bin.arxic = dist/cli.js`,
  `scripts.build = tsup`. A tsup bundle would not carry the esbuild `__name`
  helper into `page.evaluate` callbacks.
- **But the runner never uses it** — `dg11-run-validation.ts:1162`:

  ```ts
  const { runCli } = await import('../../../apps/cli/src/index');
  ```

  invoked as `pnpm exec tsx packages/intent-proposal-spike/scripts/dg11-run-validation.ts`
  (usage header `:21-23`), and `:1207-1213` calls
  `runCli(['run', '--config', configPath, '--out', outDir, '--run-id', context.runId], …)`
  with NO `--executor` flag — `apps/cli/src/cli.ts:48-50` then defaults to the
  LOCAL executor (`defaultExecutor('local')`, cli.ts:86-92). The whole local
  lane therefore always executes from TypeScript source under tsx.

- Consequence: every in-surface mitigation requires changes OUTSIDE the DG-12
  allowed surface (`docs/evidence/DG-12/**`, `scripts/dg12-*.mjs`, the ADR
  status flip, the slice note): either (a) the runner gains `--executor worker`
  or imports the dist build (`packages/**` — denied; also owned by the closed
  #255 program), or (b) the local lane / crawlee adapter is fixed to keep
  `__name` out of `page.evaluate` callbacks (`packages/**`/`apps/**` — denied).
  Running the dist CLI manually with `--executor worker` (the flag exists,
  args.ts:12) would bypass the DG-11 recording proxy, the per-call telemetry,
  and the spend ledger discipline — incompatible with criterion 5's #255
  record-set citation and the budget program. **Recorded as candidate FINDING
  F-B (C-5 path); not fixed.**

Corroborating DG-11 artifacts (why this gates coverage AND replays): both
recorded campaigns' surface maps are EMPTY —
`docs/evidence/DG-11/directus/runs/directus-g3-run3/artifacts/05.json`:
0 routes, 0 navigationEdges, diagnostics `{ARXIC-SURFACE-005: 1,
ARXIC-SURFACE-008: 1}`; `docs/evidence/DG-11/koel/runs/koel-g3-run1/artifacts/05.json`:
0 routes, 0 edges, `{ARXIC-SURFACE-001: 19, ARXIC-SURFACE-005: 1}`. The runtime
crawl tier contributed nothing; all inventory rows are source-tier. The
verifier additionally REQUIRES runtime evidence to bind the generated spec
(verifier.ts:186-187: "Runtime evidence is required to bind the generated
spec") — so replays are structurally blocked while the crawl tier is empty,
even apart from F-A.

---

## 2. Candidate FINDINGs (C-5 disposition — recorded, NOT fixed; owner triage required before campaigns)

All three are product/runner changes outside the frozen DG-12 change surface
(`packages/**`, `apps/**` explicitly denied). None is fixed by this staging
commit. Per contract C-5 and FINDING 5358390733's own disposition note, they
are campaign-design inputs recorded so the exit-gate claim reads them.

**F-A — persona fixtures require target-side `/__arxic/reset` + `/__arxic/seed`; vanilla third-party targets cannot satisfy them (both lanes).**
Evidence: §1.2 (reset.ts:20-33; verifier.ts:269-270, 406-410;
local-executor.ts:207-224/217; worker main.ts:209; reference app implements the
endpoints, next.config.mjs:7-8). Effect if unfixed: with the persona env set,
stage-7 `prepareFixtures` throws `FixtureResetError` on the 404 (the run fails
earlier than DG-11's stage-10 block); without it, stage 10 blocks with `runs: []`
— either way criterion 3 (AC-4/G-4: ≥90% of attempted replays verify) is
unsatisfiable. Candidate remediations for owner triage: (1) verifier/executor
option for externally-provisioned personas (skip target-side reset when the
policy admits a boot-seeded fixture); (2) an arxic-side seed front behind the
attestation proxy (the DG-11 pattern, but that file is #255's); (3) owner
accepts the blocked outcome and renegotiates the criterion (contract change).

**F-B — SURFACE-005 `__name` anomaly kills the runtime crawl tier on the runner's local lane (tsx, source import).**
Evidence: §1.5 (dg11-run-validation.ts:1162, 1207-1213; cli.ts:48-50; empty
surface maps in both DG-11 campaigns; verifier.ts:186-187 runtime-evidence
binding). Effect if unfixed: runtime surface stays empty → surface-missing
proposal rejections persist (grounded-ratio risk, AC-3/G-3) and replays stay
structurally blocked (with F-A). Candidate remediations: worker-executor
support in the runner, dist-build import in the runner, or a local-lane
adapter fix — all product/runner issues.

**F-C — `config.target.allowedOrigins` is validated but consumed by NOTHING at the current product.**
Evidence: §1.5/§3 — the crawl adapter aborts cross-origin via
`sameOrigin(url, input.origin)` only (crawlee-adapter/src/adapter.ts:138-144,
318-325 preNavigationHooks `page.route`), the exploration PolicyEngine
hardcodes `allowedOrigins: [input.origin]`
(orchestrator-langgraph/src/exploration.ts:170), and no executor reads the
config field (grep: validator + ArxicConfig type only). Effect: the koel
template's added app origin (staged per the campaign directive, FINDING
5358390733 item 3) is INERT today — the 19 recorded SURFACE-001 SPA asset
aborts would persist until a product change plumbs `allowedOrigins` through
the crawl adapter and policy engine. Staged forward-compatibly + disclosed;
no policy weakened (`mutation: leased-fixtures-only`, `externalNetwork: deny`
unchanged).

**Net readiness assessment (INFERRED from F-A/F-B/F-C): on the current
product + current runner, neither target can produce a promoting campaign with
verifying replays. The exit runs must NOT launch until the owner triages F-A
and F-B (F-C degrades koel coverage but does not alone block). This staging
commit exists precisely so that spend is not burned on campaigns that
structurally cannot pass.**

---

## 3. Design decisions (campaign-config choices inside the DG-12 frozen surface)

**D-1 — Ledger continuity (cumulative carries; ceiling 1.00; env/ledger match pinned).**
`docs/evidence/DG-11/{directus,koel}/spend-ledger.json` copied to
`docs/evidence/DG-12/{directus,koel}/spend-ledger.json` UNCHANGED — sha256
`b9dbac6c0fba26ee963f1d7841b7a2a1b1d96afc2e9b076a197b3abd6bc5c0c1` (directus)
and `5567ded843c71b13633647352f6e18f9357e4ebe1fb98a20b7b082c009517189` (koel),
identical to the DG-11 originals. Carried state: directus ceiling 1.00,
cumulative `0.02318635` (3 valid entries); koel ceiling 1.00, cumulative
`0.0135657` (1 valid entry). Campaigns run with
`ARXIC_DG11_EVIDENCE_DIR=<abs-repo>/docs/evidence/DG-12` and
`ARXIC_DG11_CEILING_USD=1.00` — the env value equals the ledger ceiling so the
P2-7 `ceiling-mismatch` refusal (§1.1) cannot fire, and the budget is
continuous with DG-11 (decision 2 of #255: USD 1.00 per target, cumulative
DG-11 + DG-12).

**D-2 — Templates.** `docs/evidence/DG-12/{directus,koel}/arxic.yaml` are
copies of the DG-11 templates with exactly three deltas, each disclosed in-file:
(a) `models.provider: openai/gpt-4o-mini` — unchanged from the DG-11
decision-2 amendment 2 value (kept; prices 0.15/0.60 per #255 owner decision 2,
re-verified by the operator at run time);
(b) KOEL ONLY: `target.allowedOrigins` gains `http://127.0.0.1:8123` — the
same-host loopback app origin, per FINDING 5358390733 item 3; disclosed as
INERT at the current product (F-C) and staged for forward compatibility; a
config value, not a policy weakening (`externalNetwork` stays `deny`,
`mutation` stays `leased-fixtures-only` — and neither enforcement point reads
the field today);
(c) BOTH: `fixtures.personaProvisioner: boot-seeded-admin` — a truthful
provider-name label for the campaign's fixture strategy (the registered-user
persona is an admin seeded at TARGET BOOT: directus bootstrap [already done],
koel `koel:init` [§1.3]), per the config shape found in §1.2: provider string
only, inert for provisioning on both lanes, NO credential ever in YAML.

**D-3 — maxUrls / maxDepth stay 8 / 1 (no widening; no DECISION proposed).**
The DG-11 coverage shortfalls (directus 71/105 = 67.6%, koel 157/315 = 49.8%)
were NOT URL-budget exhaustion: FINDING 5358390733 item 4 attributes them to
proposal batching on hint-less rows, `ARXIC-ORCH-PROPOSAL-SURFACE-MISSING`
rejections, and the degraded crawl — and both surface maps recorded ZERO
routes, i.e. the crawl never even reached its 8-URL budget. Widening `maxUrls`
now would change measured conditions without evidence that the budget binds.
Re-evaluation belongs to the owner AFTER F-B remediation, recorded before any
measurement (ADR-008 tuning rule).

**D-4 — Run ids and verification runs.** `directus-dg12-run1`,
`directus-dg12-run2`, `koel-dg12-run1`, `koel-dg12-run2` (pattern-valid §1.1;
two CLEAN runs per app per criterion 3/6). `policy.requiredVerificationRuns: 2`
kept (template value; validator default is also 2, validate.ts:104-111).

**D-5 — Budget sizing at preflight.** Runner row-estimate defaults kept
(directus 272, koel 306 ⇒ estimates ≈ $0.0202 / $0.0228 per run at 0.15/0.60
pricing); remaining headroom ($0.9768 directus / $0.9864 koel) covers two runs
per app with wide margin. If F-B remediation enlarges the discovered surfaces,
the operator re-sets `ARXIC_DG11_ESTIMATED_ROWS` to the then-current
expectation BEFORE the run (recorded pre-measurement, per FINDING item 4's
"budget per remaining-row count"); the proxy's hard per-call ceiling refusal
remains the fail-closed bound regardless.

---

## 4. Campaign launch procedures (for the campaign operator — NOT executed by this staging)

All commands run from the repository root (the `.worktrees/DG-12` checkout at
the merged design SHA). Model credentials come from the operator's environment;
nothing below prints or commits them.

### 4.0 Preconditions (owner-gated, before any spend)

1. Owner triage of F-A and F-B (§2) — campaigns are structurally blocked until
   remediated or the owner renegotiates; F-C degrades koel coverage only.
2. #255 closed (OBSERVED: validator closure landed — CLOSURE EVIDENCE
   issuecomment-5359553244) ✓ already satisfied.
3. Two clean runs per app only start after a `--preflight-only` dry check
   passes.

### 4.1 directus

```bash
# 1. Boot (one-time bootstrap incl. admin already recorded in BOOT-PROCEDURES.md)
cd /home/soultransit/devtony/thirdparty-dg/directus
docker run -d --name directus-rehearsal -u "$(id -u):$(id -g)" -e HOME=/tmp \
  -p 127.0.0.1:8055:8055 \
  -e DB_CLIENT=sqlite3 -e DB_FILENAME=/data/data.db \
  -e SECRET=<rehearsal-secret-per-BOOT-PROCEDURES> \
  -e HOST=0.0.0.0 -e PORT=8055 \
  -e EXTENSIONS_PATH=/data/extensions -e STORAGE_LOCAL_ROOT=/data/uploads \
  -v "$PWD":/repo -v "$PWD/../directus-data":/data -w /repo \
  directus-node22:rehearsal node api/dist/cli/run.js start
curl -s http://127.0.0.1:8055/server/ping   # expect 200 "pong"

# 2. Launcher env (run-time extraction; NEVER commit these values)
cd <repo-root>
export ARXIC_MODEL_BASE_URL=<real-upstream-base>        # operator-held
export ARXIC_MODEL_API_KEY=<real-key>                   # operator-held secret
export ARXIC_INPUT_PERSONA_EMAIL="$(grep -m1 -oP '(?<=ADMIN_EMAIL=)\S+' /home/soultransit/devtony/thirdparty-dg/BOOT-PROCEDURES.md)"
export ARXIC_INPUT_PERSONA_PASSWORD="$(grep -m1 -oP '(?<=ADMIN_PASSWORD=)\S+' /home/soultransit/devtony/thirdparty-dg/BOOT-PROCEDURES.md)"

# 3. Dry preflight (zero spend)
ARXIC_DG11_EVIDENCE_DIR="$PWD/docs/evidence/DG-12" ARXIC_DG11_CEILING_USD=1.00 \
ARXIC_DG11_TARGET_REPO=/home/soultransit/devtony/thirdparty-dg/directus \
ARXIC_DG11_TARGET_APP_ORIGIN=http://127.0.0.1:8055 \
ARXIC_DG11_ESTIMATED_ROWS=272 \
pnpm exec tsx packages/intent-proposal-spike/scripts/dg11-run-validation.ts \
  directus --preflight-only

# 4. Two clean runs
for N in 1 2; do
  ARXIC_DG11_EVIDENCE_DIR="$PWD/docs/evidence/DG-12" ARXIC_DG11_CEILING_USD=1.00 \
  ARXIC_DG11_RUN_ID="directus-dg12-run$N" \
  ARXIC_DG11_TARGET_REPO=/home/soultransit/devtony/thirdparty-dg/directus \
  ARXIC_DG11_TARGET_APP_ORIGIN=http://127.0.0.1:8055 \
  ARXIC_DG11_ESTIMATED_ROWS=272 \
  ARXIC_DG11_CONFIRM_REAL_SPEND=1 \
  pnpm exec tsx packages/intent-proposal-spike/scripts/dg11-run-validation.ts directus
done

# 5. Record the ledger JSON per run (C-2). The argv entry is the tsup footer
#    (runCli(process.argv.slice(2)); apps/cli/tsup.config.ts) — build once, then:
pnpm --filter arxic build
node apps/cli/dist/cli.js intents \
  docs/evidence/DG-12/directus/runs/directus-dg12-run$N --json \
  > docs/evidence/DG-12/directus/runs/directus-dg12-run$N.intents.json

# 6. Stop the app
docker stop directus-rehearsal && docker rm directus-rehearsal
```

### 4.2 koel

```bash
# 1. ONE-TIME admin seed (§1.3 — artisan, deterministic, idempotent, porcelain-clean)
cd /home/soultransit/devtony/thirdparty-dg/koel
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$PWD":/var/www/koel -v "$PWD/../koel-data":/data -w /var/www/koel \
  koel-php83:rehearsal php artisan koel:init --no-interaction --no-assets --no-scheduler

# 2. Boot
docker run -d --name koel-rehearsal -u "$(id -u):$(id -g)" -e HOME=/tmp \
  -p 127.0.0.1:8123:8123 \
  -v "$PWD":/var/www/koel -v "$PWD/../koel-data":/data -w /var/www/koel \
  koel-php83:rehearsal php artisan serve --host=0.0.0.0 --port=8123
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8123/   # expect 200

# 3. Launcher env — persona = the koel:first-admin constants, extracted from the CLONE at run time
cd <repo-root>
export ARXIC_MODEL_BASE_URL=<real-upstream-base>
export ARXIC_MODEL_API_KEY=<real-key>
export ARXIC_INPUT_PERSONA_EMAIL="$(sed -n "s/.*FIRST_ADMIN_EMAIL = '\([^']*\)'.*/\1/p" /home/soultransit/devtony/thirdparty-dg/koel/app/Models/User.php)"
export ARXIC_INPUT_PERSONA_PASSWORD="$(sed -n "s/.*FIRST_ADMIN_PASSWORD = '\([^']*\)'.*/\1/p" /home/soultransit/devtony/thirdparty-dg/koel/app/Models/User.php)"

# 4. Dry preflight, then two clean runs (same loop shape as §4.1 with)
#    ARXIC_DG11_RUN_ID="koel-dg12-run$N" ARXIC_DG11_ESTIMATED_ROWS=306
#    ARXIC_DG11_TARGET_REPO=/home/soultransit/devtony/thirdparty-dg/koel
#    ARXIC_DG11_TARGET_APP_ORIGIN=http://127.0.0.1:8123

# 5. Record intents JSON per run; 6. docker stop koel-rehearsal && docker rm koel-rehearsal
```

Operator notes: the runner asserts the clone HEAD equals the ratified pin
before anything that can spend (zero-call refusal `commit-mismatch` otherwise);
`ARXIC_MODEL_BUDGET_USD` is set by the runner itself from ledger headroom
(dg11-run-validation.ts:1206) — do not export it manually; every run record is
redaction-scanned before write and quarantined on any finding (SP-5 mechanics).

---

## 5. Assertion-script plan (per the frozen contract's gate commands)

The `scripts/dg12-*.mjs` scripts do not exist yet — they are a subsequent
deliverable of this issue (allowed surface) and MUST be authored red-first
before the campaigns' artifacts exist, so the exit ratios are asserted by
script, never eyeballed. Plan (exact commands from the #256 contract; the
`APP/run-1`/`run-2` paths map to the runner's `runs/<runId>` layout):

| Gate | Command (contract text)                                                                          | Maps to (this design's run-ids)                 | Pass condition                                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G-2  | `node scripts/dg12-coverage.mjs docs/evidence/DG-12/APP`                                         | `docs/evidence/DG-12/{directus,koel}`           | exit 0: 100% of `artifacts/13.json` inventory rows appear in the run's intent ledger with a disposition                                                        |
| G-3  | `node scripts/dg12-grounded-ratio.mjs docs/evidence/DG-12/APP --threshold 80`                    | same                                            | exit 0: grounded rows / inventory rows ≥ 0.80 (owner-tunable only BEFORE measurement)                                                                          |
| G-4  | `node scripts/dg12-replay-ratio.mjs docs/evidence/DG-12/APP/run-1 docs/evidence/DG-12/APP/run-2` | `…/{directus,koel}/runs/<target>-dg12-run{1,2}` | exit 0: verified / attempted replays ≥ 0.90 across the two clean runs, consuming the recorded verifier output wholesale                                        |
| G-7  | `node scripts/dg12-determinism.mjs --rebuild docs/evidence/DG-12/APP/run-1`                      | `…/<target>/runs/<target>-dg12-run1`            | exit 0: ledger rebuilt twice over run-1's recorded artifacts byte-identical modulo `generatedAt`; two-run comparison recorded as OBSERVED sampling attribution |

Supporting hygiene per contract G-6: `scanTextForSecrets` sweep over
`docs/evidence/DG-12/**` (zero findings required — which is exactly why this
design record and the templates carry NO credential-shaped strings), plus the
per-app real-model citation check against the DG-11/#255 record set (satisfied
by the run records the runner writes into the DG-12 evidence dir under the
copied ledgers). Inputs consumed by the scripts: `runs/<runId>/artifacts/13.json`
(inventory denominator), `runs/<runId>/intents.json` (ledger — also recorded as
`<runId>.intents.json` via `arxic intents --json`, §4), `runs/<runId>.json`
(run record incl. verification outcome), `artifacts/10.json` (verification).

---

## 6. What remains before the runs (hand-off state)

1. **Owner triage of F-A and F-B (§2)** — blocking. Each remediation is a
   product/runner change requiring its own issue (C-5); until one lands (or the
   owner renegotiates the affected criteria via CONTRACT CHANGE REQUEST), the
   exit campaigns must not spend: stage 7/10 fail closed as recorded above.
2. **Koel admin seed at boot time** (§4.2 step 1) — one command, operator-run,
   before the first koel campaign; directus needs nothing (bootstrap done).
3. **Author the four `scripts/dg12-*.mjs` assertion scripts red-first** (§5) —
   in-surface, before campaign artifacts exist.
4. Re-verify gpt-4o-mini prices at run time (owner decision 2 standing rule).
5. Then the two clean runs per app (§4), the assertion gates, the exit report
   (C-9 redaction sweep), and LAST the ADR-008 flip PR (C-8).
