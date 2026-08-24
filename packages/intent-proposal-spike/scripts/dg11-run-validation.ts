/**
 * DG-11 validation runner (#255): executes a REAL-model `arxic run` against
 * an owner-ratified target within the owner-set budget, recording per-call
 * telemetry the production pipeline does not persist (stage 4 consumes only
 * response.output — packages/orchestrator-langgraph/src/intent-proposer.ts:499-523;
 * the stage-4 artifact whitelist drops run records — orchestrator.ts:1806).
 *
 * Mechanism: a LOCAL recording proxy in front of the real model endpoint.
 * The child `arxic run` sees ARXIC_MODEL_BASE_URL=http://127.0.0.1:<ephemeral>
 * plus a dummy canary key; the proxy injects the real Authorization ONLY on
 * the upstream hop and records requestId/model/tokens/latency/cost per call.
 * The real key exists ONLY in this process — never in arxic's env, the run
 * artifacts, or any log line.
 *
 * A second local proxy fronts the booted target with the attestation
 * well-known (environmentClass local-test, exact proxy origin, fresh nonce,
 * buildDigest = sha256 over the clone's `git rev-parse HEAD^{tree}`) and
 * forwards everything else to the app — vanilla third-party targets pass
 * preflight without any modification of the pristine clone.
 *
 * Usage (from the repository root):
 *   pnpm exec tsx packages/intent-proposal-spike/scripts/dg11-run-validation.ts \
 *     <directus|koel> [--preflight-only]
 *
 * Required env (RUN mode — never committed, never in CI; CI stays stub-model):
 *   ARXIC_MODEL_BASE_URL      REAL upstream base (e.g. https://openrouter.ai/api/v1)
 *   ARXIC_MODEL_API_KEY       REAL API key (secret; exists only in this process)
 *   ARXIC_DG11_TARGET_REPO    absolute path of the pristine clone at its pin
 *   ARXIC_DG11_TARGET_APP_ORIGIN  origin of the booted target app (e.g. http://127.0.0.1:8055)
 *   ARXIC_DG11_CONFIRM_REAL_SPEND=1  explicit spend acknowledgment (defense in depth)
 * Optional env:
 *   ARXIC_DG11_EVIDENCE_DIR   default docs/evidence/DG-11
 *   ARXIC_DG11_CEILING_USD    per-target cumulative ceiling, default 1.00 (owner decision 1).
 *                             Once a ledger exists this MUST equal the ledger's ceiling or
 *                             preflight refuses (ceiling-mismatch) — adoption is manual
 *                             (docs/evidence/DG-11/README.md).
 *   ARXIC_DG11_PRICE_PROMPT / ARXIC_DG11_PRICE_COMPLETION  USD per million tokens,
 *                             defaults 0.15 / 0.60 (owner decision 2; re-verify at run time).
 *                             Both must be STRICTLY positive — zero prices refuse (zero-price).
 *   ARXIC_DG11_ESTIMATED_ROWS override the per-target measured row estimate
 *   ARXIC_DG11_RUN_ID         record/run id (default dg11-<target>-<utc stamp>); must match
 *                             ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ — it becomes a path component
 *
 * The per-row token estimate cites the DG-04/DG-08 pipeline constants
 * (packages/orchestrator-langgraph/src/intent-proposer.ts:73-74: 156 prompt +
 * 85 completion tokens per row) which back the pipeline's own pre-call gate
 * (estimateProposalCostUsd, intent-proposer.ts:240-250).
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalJson, sha256 } from '@arxic/contracts';
import { scanTextForSecrets } from '../../bundle-promoter/src/redaction-gate';
import { sanitizeArtifactJson } from '../src/proposer';
import {
  DG11_RECORD_KIND_REFUSAL,
  DG11_RECORD_KIND_RUN,
  DG11_SPEND_LEDGER_SCHEMA,
  validateLedgerDocument,
} from './validate-records';

export type Dg11Prices = Readonly<{ promptPerMillion: number; completionPerMillion: number }>;

/** Owner decision 1: USD 1.00 per ratified target, cumulative (DG-11 + DG-12). */
export const DG11_DEFAULT_CEILING_USD = 1.0;
/** Owner decision 2: gpt-4o-mini list prices at DG-04 measurement — RE-VERIFY at run time. */
export const DG11_DEFAULT_PRICES: Dg11Prices = {
  promptPerMillion: 0.15,
  completionPerMillion: 0.6,
};
/**
 * DG-04-measured per-row token profile — mirrors the pipeline's own estimate
 * constants (packages/orchestrator-langgraph/src/intent-proposer.ts:73-74),
 * which are module-private there; re-declared here with the citation so the
 * runner's preflight matches the pipeline's pre-call gate exactly.
 */
export const ESTIMATED_PROMPT_TOKENS_PER_ROW = 156;
export const ESTIMATED_COMPLETION_TOKENS_PER_ROW = 85;
/**
 * Per-target estimated row counts for preflight. koel is the DG-06 FUSED
 * count (306 totalRows — docs/evidence/DG-06/fusion-summary.json; the 239 in
 * DG-05 was the pre-fusion interchange route count). directus 272 is the
 * DG-04 pre-fusion interchange count (docs/evidence/DG-04/scale-matrix.json)
 * — no DG-06-style fusion was measured for directus, so its fusion-time
 * count is unknown until the first real G-3 run reports coverage.rows;
 * override with ARXIC_DG11_ESTIMATED_ROWS then.
 */
export const DG11_TARGET_ROW_ESTIMATES: Readonly<Record<string, number>> = {
  directus: 272,
  koel: 306,
};
/** Ratified pins (owner decision 3, OBSERVED in the #255 contract). */
export const DG11_TARGET_PINS: Readonly<Record<string, string>> = {
  directus: 'cb846b6a1ddc4811359bc52b74bb31a42eab33db',
  koel: 'dfec91ff290509c622ff7cf392fb5e506841ee2b',
};
/**
 * Explicit upstream repository URLs per ratified target — never derived from
 * the target name (dual-review finding 15: the coincidence fallback is gone).
 */
export const DG11_TARGET_REPOSITORIES: Readonly<Record<string, string>> = {
  directus: 'https://github.com/directus/directus',
  koel: 'https://github.com/koel/koel',
};
/**
 * Run ids become path components (`runs/<runId>.json`,
 * `refusals/<runId>-<reason>.json`) — reject anything outside this safe
 * charset before path use (dual-review finding 11).
 */
export const DG11_RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export function isValidRunId(runId: string): boolean {
  return DG11_RUN_ID_PATTERN.test(runId);
}

/**
 * Model id sentinel for runs whose telemetry recorded zero calls (finding 12);
 * the validator accepts it ONLY with zero telemetry.
 */
export const DG11_MODEL_SENTINEL = 'unobserved';

/** Static 401 body for unauthenticated proxy callers (finding 6) — never varies. */
export const DG11_PROXY_UNAUTHORIZED_BODY =
  '{"error":{"code":"ARXIC-DG11-PROXY-AUTH","message":"DG-11 recording proxy: wrong or missing inbound bearer"}}';

export type SpendLedgerEntry = Readonly<{
  runId: string;
  recordedAt: string;
  measuredCostUsd: number;
  calls: number;
  valid: boolean;
  /**
   * True when this run left forwarded calls without telemetry rows. Such an
   * entry freezes the ledger's remaining headroom to $0 until manual repair
   * (fail-closed — recorded cumulative is known to understate real spend).
   */
  readonly accountingGap?: boolean;
}>;

export type SpendLedger = Readonly<{
  schemaVersion: typeof DG11_SPEND_LEDGER_SCHEMA;
  target: string;
  repository?: string;
  commit?: string;
  ceilingUsd: number;
  cumulativeUsd: number;
  entries: readonly SpendLedgerEntry[];
}>;

export type TelemetryCall = Readonly<{
  requestId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  costUsd: number;
}>;

export type RefusalReason =
  | 'budget-ceiling'
  | 'credentials-missing'
  | 'proxy-ceiling'
  | 'redaction-finding'
  | 'zero-price'
  | 'ledger-unreadable'
  | 'ceiling-mismatch'
  | 'commit-mismatch';

export type RefusalRecord = Readonly<{
  kind: typeof DG11_RECORD_KIND_REFUSAL;
  schemaVersion: 1;
  target: { name: string };
  runId: string;
  at: string;
  reason: RefusalReason;
  detail: string;
  estimateUsd?: number;
  cumulativeUsd?: number;
  ceilingUsd?: number;
  remainingUsd?: number;
  upstreamCallsPlaced: number;
}>;

export type PreflightOutcome = Readonly<{
  disposition:
    | 'ok'
    | 'refused-budget'
    | 'refused-credentials'
    | 'refused-pricing'
    | 'refused-ledger'
    | 'refused-ceiling';
  estimateUsd: number;
  /** Ledger-derived budget state — undefined only for refused-ledger. */
  cumulativeUsd?: number;
  ceilingUsd?: number;
  remainingUsd?: number;
  refusal?: RefusalRecord;
}>;

/** Pre-call cost estimate — identical math to the pipeline's own gate. */
export function estimateRunCostUsd(rows: number, prices: Dg11Prices): number {
  const prompt = rows * ESTIMATED_PROMPT_TOKENS_PER_ROW;
  const completion = rows * ESTIMATED_COMPLETION_TOKENS_PER_ROW;
  return (
    (prompt / 1_000_000) * prices.promptPerMillion +
    (completion / 1_000_000) * prices.completionPerMillion
  );
}

export function emptySpendLedger(
  target: string,
  ceilingUsd: number,
  meta: { repository?: string; commit?: string },
): SpendLedger {
  return {
    schemaVersion: DG11_SPEND_LEDGER_SCHEMA,
    target,
    ...(meta.repository ? { repository: meta.repository } : {}),
    ...(meta.commit ? { commit: meta.commit } : {}),
    ceilingUsd,
    cumulativeUsd: 0,
    entries: [],
  };
}

function roundTo9(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

function usdNear(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-9;
}

export function appendSpendLedgerEntry(ledger: SpendLedger, entry: SpendLedgerEntry): SpendLedger {
  const cumulativeUsd = roundTo9(
    ledger.entries.reduce((sum, item) => sum + item.measuredCostUsd, 0) + entry.measuredCostUsd,
  );
  return { ...ledger, cumulativeUsd, entries: [...ledger.entries, entry] };
}

/**
 * A ledger that exists but cannot be parsed/validated (dual-review finding 2).
 * Carries the path and the concrete failure so refusals can name both.
 */
export class SpendLedgerReadError extends Error {
  readonly failure: string;

  constructor(path: string, failure: string) {
    super(`spend ledger at ${path}: ${failure}`);
    this.name = 'SpendLedgerReadError';
    this.failure = failure;
  }
}

/**
 * Strict ledger reader: parses AND coherence-validates (schemaVersion,
 * cumulative == Σ entries). ENOENT propagates as a raw fs error with code
 * ENOENT (the single legitimate "start fresh" signal); every other failure is
 * a SpendLedgerReadError the callers must refuse on.
 */
export async function readSpendLedger(path: string): Promise<SpendLedger> {
  const raw = await readFile(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new SpendLedgerReadError(path, `not valid JSON (${(cause as Error).message})`);
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as { schemaVersion?: unknown }).schemaVersion !== DG11_SPEND_LEDGER_SCHEMA
  ) {
    throw new SpendLedgerReadError(path, `not ${DG11_SPEND_LEDGER_SCHEMA}`);
  }
  const check = validateLedgerDocument(parsed);
  if (!check.ok) {
    throw new SpendLedgerReadError(path, check.problems.join('; '));
  }
  return parsed as SpendLedger;
}

/** Result of classifying a ledger path: fresh/loaded, or unreadable (refuse). */
export type LedgerLoad =
  | Readonly<{ status: 'loaded'; ledger: SpendLedger; existed: boolean }>
  | Readonly<{ status: 'unreadable'; path: string; failure: string }>;

/**
 * Classify a ledger path for use: ENOENT → a legitimate fresh (empty) ledger;
 * parse/validation failure → `unreadable` (the caller must REFUSE and never
 * rewrite the file); anything readable → as-is (finding 2).
 */
export async function loadSpendLedger(input: {
  path: string;
  target: string;
  ceilingUsd: number;
  repository?: string;
  commit?: string;
}): Promise<LedgerLoad> {
  try {
    return { status: 'loaded', ledger: await readSpendLedger(input.path), existed: true };
  } catch (error) {
    if (error instanceof SpendLedgerReadError) {
      return { status: 'unreadable', path: input.path, failure: error.failure };
    }
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return {
        status: 'loaded',
        ledger: emptySpendLedger(input.target, input.ceilingUsd, {
          ...(input.repository ? { repository: input.repository } : {}),
          ...(input.commit ? { commit: input.commit } : {}),
        }),
        existed: false,
      };
    }
    return { status: 'unreadable', path: input.path, failure: (error as Error).message };
  }
}

/** Atomic, byte-deterministic write (canonical JSON + newline, mode 0o640). */
export async function writeSpendLedgerAtomic(path: string, ledger: SpendLedger): Promise<void> {
  await writeArtifactAtomic(path, `${canonicalJson(ledger)}\n`);
}

export async function writeArtifactAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const staged = `${path}.${randomUUID()}.stage`;
  await writeFile(staged, text, { encoding: 'utf8', mode: 0o640, flag: 'wx' });
  await rename(staged, path);
}

export function remainingHeadroomUsd(ledger: SpendLedger): number {
  // Fail-closed freeze (finding 3): an accounting-gap entry means recorded
  // cumulative is known to understate real spend — no headroom until repaired.
  if (ledger.entries.some((entry) => entry.accountingGap === true)) return 0;
  return roundTo9(ledger.ceilingUsd - ledger.cumulativeUsd);
}

/**
 * Honest ledger arithmetic for a run record (finding 4): cumulative stays
 * TRUE (may exceed the ceiling by at most one call — the proxy checks the
 * ceiling BEFORE forwarding, not after); remainingUsd clamps to 0 instead of
 * going negative; the overrun is reported so the record stays self-valid.
 *
 * Gap-awareness (delta re-review P3): when accountingGapCalls > 0 the run
 * ALSO carries an `accounting-gap` event, and the validator freezes
 * `after.remainingUsd` to 0 while such an event is present (recorded
 * cumulative understates real spend). The freeze mirrors
 * remainingHeadroomUsd(): after.remainingUsd is clamped to 0 while the TRUE
 * cumulative is preserved.
 */
export function finalizeLedgerArithmetic(
  before: Readonly<{ cumulativeUsd: number; ceilingUsd: number }>,
  measuredCostUsd: number,
  accountingGapCalls = 0,
): {
  before: Readonly<{ cumulativeUsd: number; ceilingUsd: number; remainingUsd: number }>;
  after: Readonly<{ cumulativeUsd: number; ceilingUsd: number; remainingUsd: number }>;
  overshootUsd: number;
} {
  const ceilingUsd = before.ceilingUsd;
  const afterCumulative = roundTo9(before.cumulativeUsd + measuredCostUsd);
  const overshootUsd =
    afterCumulative > ceilingUsd + 1e-9 ? roundTo9(afterCumulative - ceilingUsd) : 0;
  return {
    before: {
      cumulativeUsd: before.cumulativeUsd,
      ceilingUsd,
      remainingUsd: Math.max(0, roundTo9(ceilingUsd - before.cumulativeUsd)),
    },
    after: {
      cumulativeUsd: afterCumulative,
      ceilingUsd,
      remainingUsd:
        accountingGapCalls > 0 ? 0 : Math.max(0, roundTo9(ceilingUsd - afterCumulative)),
    },
    overshootUsd,
  };
}

/** Event row emitted into a run record's events[] (open type/at/detail shape). */
export type RunEvent = Readonly<{ type: string; at: string; detail: string; overrunUsd?: number }>;

/**
 * Build the events[] block: proxy refusals, accounting gaps (finding 3), and
 * ceiling overshoot (finding 4). A non-empty accountingGapCalls freezes the
 * run to invalid; a positive overshootUsd adds the mandatory overshoot event.
 */
export function buildRunEvents(input: {
  refusals: readonly RefusalRecord[];
  accountingGapCalls: number;
  overshootUsd: number;
  at: string;
}): RunEvent[] {
  const events: RunEvent[] = input.refusals.map((refusal) => ({
    type: 'refusal',
    at: refusal.at,
    detail: refusal.detail,
  }));
  if (input.accountingGapCalls > 0) {
    events.push({
      type: 'accounting-gap',
      at: input.at,
      detail: `${input.accountingGapCalls} forwarded upstream call(s) produced no telemetry row (unparseable response, upstream error, or forward still in flight after drain); the run is INVALID and remaining headroom is frozen to 0 until manual ledger repair (docs/evidence/DG-11/README.md)`,
    });
  }
  if (input.overshootUsd > 0) {
    events.push({
      type: 'ceiling-overshoot',
      at: input.at,
      overrunUsd: input.overshootUsd,
      detail: `measured cumulative spend exceeded the ceiling by $${input.overshootUsd.toFixed(9)} (the final allowed call may overshoot by at most one call); remaining headroom clamped to 0`,
    });
  }
  return events;
}

/**
 * Budget-first preflight (G-4/SP-1/SP-2). Order (each stage fail-closed with
 * zero spend): ledger integrity (finding 2) → ceiling agreement (finding 7) →
 * strictly-positive prices (finding 1) → budget headroom → credentials. The
 * budget boundary still runs before the credential check so it is provable
 * with zero credentials and zero spend. No side effects: the caller writes
 * the refusal record.
 */
export async function runPreflightChecks(input: {
  target: string;
  estimatedRows: number;
  ledgerPath: string;
  prices: Dg11Prices;
  env: { ARXIC_MODEL_BASE_URL: string; ARXIC_MODEL_API_KEY: string };
  /** Ceiling from ARXIC_DG11_CEILING_USD — undefined = "ledger is authoritative". */
  ceilingUsd?: number;
  now?: () => string;
}): Promise<PreflightOutcome> {
  const now = input.now ?? (() => new Date().toISOString());
  const load = await loadSpendLedger({
    path: input.ledgerPath,
    target: input.target,
    ceilingUsd: input.ceilingUsd ?? DG11_DEFAULT_CEILING_USD,
    repository: DG11_TARGET_REPOSITORIES[input.target],
    commit: DG11_TARGET_PINS[input.target],
  });
  const estimateUsd = roundTo9(estimateRunCostUsd(input.estimatedRows, input.prices));
  if (load.status === 'unreadable') {
    return {
      disposition: 'refused-ledger',
      estimateUsd,
      refusal: {
        kind: DG11_RECORD_KIND_REFUSAL,
        schemaVersion: 1,
        target: { name: input.target },
        runId: 'preflight',
        at: now(),
        reason: 'ledger-unreadable',
        detail: `spend ledger at ${load.path} could not be read (${load.failure}); refusing fail-closed — cumulative spend must never silently reset; repair the ledger manually per docs/evidence/DG-11/README.md; no ledger write was performed`,
        estimateUsd,
        upstreamCallsPlaced: 0,
      },
    };
  }
  const ledger = load.ledger;
  const base = {
    estimateUsd,
    cumulativeUsd: ledger.cumulativeUsd,
    ceilingUsd: ledger.ceilingUsd,
    remainingUsd: remainingHeadroomUsd(ledger),
  };
  if (
    load.existed &&
    input.ceilingUsd !== undefined &&
    !usdNear(input.ceilingUsd, ledger.ceilingUsd)
  ) {
    return {
      ...base,
      disposition: 'refused-ceiling',
      refusal: {
        kind: DG11_RECORD_KIND_REFUSAL,
        schemaVersion: 1,
        target: { name: input.target },
        runId: 'preflight',
        at: now(),
        reason: 'ceiling-mismatch',
        detail: `ARXIC_DG11_CEILING_USD=${input.ceilingUsd} does not match the existing ledger ceiling=${ledger.ceilingUsd} for target ${input.target}; refusing — to adopt a new ceiling follow the manual adoption procedure in docs/evidence/DG-11/README.md`,
        estimateUsd,
        cumulativeUsd: ledger.cumulativeUsd,
        ceilingUsd: ledger.ceilingUsd,
        remainingUsd: Math.max(0, base.remainingUsd),
        upstreamCallsPlaced: 0,
      },
    };
  }
  if (!(input.prices.promptPerMillion > 0) || !(input.prices.completionPerMillion > 0)) {
    return {
      ...base,
      disposition: 'refused-pricing',
      refusal: {
        kind: DG11_RECORD_KIND_REFUSAL,
        schemaVersion: 1,
        target: { name: input.target },
        runId: 'preflight',
        at: now(),
        reason: 'zero-price',
        detail: `prices must be strictly positive (got prompt ${input.prices.promptPerMillion} / completion ${input.prices.completionPerMillion} USD per million tokens); zero prices would zero every estimate and recorded cost, leaving the ceiling unable to trip`,
        estimateUsd,
        cumulativeUsd: ledger.cumulativeUsd,
        ceilingUsd: ledger.ceilingUsd,
        remainingUsd: Math.max(0, base.remainingUsd),
        upstreamCallsPlaced: 0,
      },
    };
  }
  if (base.remainingUsd + 1e-9 < estimateUsd) {
    return {
      ...base,
      disposition: 'refused-budget',
      refusal: {
        kind: DG11_RECORD_KIND_REFUSAL,
        schemaVersion: 1,
        target: { name: input.target },
        runId: 'preflight',
        at: now(),
        reason: 'budget-ceiling',
        detail: `remaining headroom $${base.remainingUsd.toFixed(6)} is below the estimated run cost $${estimateUsd.toFixed(6)}; zero model calls placed`,
        estimateUsd,
        cumulativeUsd: ledger.cumulativeUsd,
        ceilingUsd: ledger.ceilingUsd,
        remainingUsd: Math.max(0, base.remainingUsd),
        upstreamCallsPlaced: 0,
      },
    };
  }
  if (!input.env.ARXIC_MODEL_BASE_URL.trim() || !input.env.ARXIC_MODEL_API_KEY.trim()) {
    return {
      ...base,
      disposition: 'refused-credentials',
      refusal: {
        kind: DG11_RECORD_KIND_REFUSAL,
        schemaVersion: 1,
        target: { name: input.target },
        runId: 'preflight',
        at: now(),
        reason: 'credentials-missing',
        detail:
          'ARXIC_MODEL_BASE_URL / ARXIC_MODEL_API_KEY absent or blank at run start; the run refuses fail-closed with zero fabricated candidates',
        cumulativeUsd: ledger.cumulativeUsd,
        ceilingUsd: ledger.ceilingUsd,
        remainingUsd: Math.max(0, base.remainingUsd),
        upstreamCallsPlaced: 0,
      },
    };
  }
  return { ...base, disposition: 'ok' };
}

export function costOfTokens(
  promptTokens: number,
  completionTokens: number,
  prices: Dg11Prices,
): number {
  return roundTo9(
    (promptTokens / 1_000_000) * prices.promptPerMillion +
      (completionTokens / 1_000_000) * prices.completionPerMillion,
  );
}

async function listenLoopback(server: Server): Promise<number> {
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('could not allocate loopback port');
  return address.port;
}

/**
 * Local recording proxy in front of the real model endpoint. Injects the
 * real Authorization only on the upstream hop; records per-call telemetry;
 * hard-refuses (HTTP 402, ARXIC-DG11-SPEND-CEILING) to forward once measured
 * cumulative spend (spendBefore + recorded) reaches the ceiling.
 *
 * Security (dual-review finding 6): inbound callers must present the run's
 * dummy canary bearer — anything else gets a static 401 and is NEVER
 * forwarded, so a random local process that discovers the port cannot spend
 * the real key.
 *
 * Accounting (dual-review finding 3): every in-flight handler is tracked;
 * stop() DRAINS them (each bounded by the upstream timeout) before closing,
 * so a response landing after the child aborted still reaches telemetry —
 * and whatever remains unreconciled is surfaced as an accounting gap by the
 * runner.
 */
export class RecordingModelProxy {
  readonly baseUrl: string;
  readonly telemetry: TelemetryCall[] = [];
  readonly refusals: RefusalRecord[] = [];
  readonly #server: Server;
  readonly #upstream: string;
  readonly #upstreamKey: string;
  readonly #inboundBearer: string;
  readonly #ceilingUsd: number;
  readonly #spendBeforeUsd: number;
  readonly #prices: Dg11Prices;
  readonly #runId: string;
  readonly #pending = new Set<Promise<void>>();
  #forwards = 0;
  #stopPromise: Promise<void> | undefined;

  private constructor(
    server: Server,
    upstream: string,
    upstreamKey: string,
    inboundBearer: string,
    ceilingUsd: number,
    spendBeforeUsd: number,
    prices: Dg11Prices,
    runId: string,
    port: number,
  ) {
    this.#server = server;
    this.baseUrl = `http://127.0.0.1:${port}`;
    this.#upstream = upstream;
    this.#upstreamKey = upstreamKey;
    this.#inboundBearer = inboundBearer;
    this.#ceilingUsd = ceilingUsd;
    this.#spendBeforeUsd = spendBeforeUsd;
    this.#prices = prices;
    this.#runId = runId;
  }

  static async start(options: {
    upstreamBaseUrl: string;
    upstreamApiKey: string;
    /** The dummy canary the child presents inbound (finding 6). */
    inboundBearer: string;
    ceilingUsd: number;
    spendBeforeUsd: number;
    prices: Dg11Prices;
    runId?: string;
  }): Promise<RecordingModelProxy> {
    const server = createHttpServer();
    const port = await listenLoopback(server);
    const proxy = new RecordingModelProxy(
      server,
      options.upstreamBaseUrl,
      options.upstreamApiKey,
      options.inboundBearer,
      options.ceilingUsd,
      options.spendBeforeUsd,
      options.prices,
      options.runId ?? 'dg11-proxy',
      port,
    );
    server.on('request', (request, response) => {
      // Aborted client sockets must never surface as unhandled errors while
      // the upstream forward continues (finding 3 drain path).
      response.on('error', () => {});
      proxy.#track(proxy.#handle(request, response));
    });
    return proxy;
  }

  #track(promise: Promise<void>): void {
    this.#pending.add(promise);
    void promise.then(
      () => {
        this.#pending.delete(promise);
      },
      () => {
        this.#pending.delete(promise);
      },
    );
  }

  measuredSpendUsd(): number {
    return roundTo9(
      this.#spendBeforeUsd + this.telemetry.reduce((sum, call) => sum + call.costUsd, 0),
    );
  }

  /** Number of requests actually FORWARDED upstream (refusals never count). */
  upstreamHits(): number {
    return this.#forwards;
  }

  stop(): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise;
    this.#stopPromise = (async () => {
      this.#server.closeIdleConnections();
      // Drain in-flight handlers first: each is bounded by the upstream
      // AbortSignal timeout, so stop() cannot hang past one upstream window.
      await Promise.allSettled([...this.#pending]);
      await new Promise<void>((resolveClose) => this.#server.close(() => resolveClose()));
    })();
    return this.#stopPromise;
  }

  async #handle(
    request: import('node:http').IncomingMessage,
    response: import('node:http').ServerResponse,
  ): Promise<void> {
    const url = request.url ?? '/';
    if (request.method !== 'POST' || url.split('?')[0] !== '/chat/completions') {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'ARXIC-DG11-PROXY-PATH' } }));
      return;
    }
    if (request.headers.authorization !== `Bearer ${this.#inboundBearer}`) {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(DG11_PROXY_UNAUTHORIZED_BODY);
      return;
    }
    if (this.measuredSpendUsd() + 1e-9 >= this.#ceilingUsd) {
      this.refusals.push({
        kind: DG11_RECORD_KIND_REFUSAL,
        schemaVersion: 1,
        target: { name: 'model-endpoint' },
        runId: this.#runId,
        at: new Date().toISOString(),
        reason: 'proxy-ceiling',
        detail: `measured cumulative spend $${this.measuredSpendUsd().toFixed(6)} reached the ceiling $${this.#ceilingUsd.toFixed(6)}; the proxy refused to forward`,
        cumulativeUsd: this.measuredSpendUsd(),
        ceilingUsd: this.#ceilingUsd,
        remainingUsd: 0,
        upstreamCallsPlaced: this.upstreamHits(),
      });
      response.writeHead(402, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          error: {
            code: 'ARXIC-DG11-SPEND-CEILING',
            message: 'DG-11 spend ceiling reached; the model call was not forwarded',
          },
        }),
      );
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    const startedAt = Date.now();
    this.#forwards += 1;
    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetch(`${this.#upstream}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.#upstreamKey}`,
          'content-type': 'application/json',
        },
        body,
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      response.writeHead(502, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'ARXIC-DG11-UPSTREAM-UNREACHABLE' } }));
      return;
    }
    const latencyMs = Date.now() - startedAt;
    const text = await upstreamResponse.text();
    if (upstreamResponse.ok) {
      try {
        const parsed = JSON.parse(text) as {
          id?: unknown;
          model?: unknown;
          usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
        };
        if (
          typeof parsed.id === 'string' &&
          typeof parsed.model === 'string' &&
          typeof parsed.usage?.prompt_tokens === 'number' &&
          typeof parsed.usage?.completion_tokens === 'number'
        ) {
          this.telemetry.push({
            requestId: parsed.id,
            model: parsed.model,
            promptTokens: parsed.usage.prompt_tokens,
            completionTokens: parsed.usage.completion_tokens,
            latencyMs,
            costUsd: costOfTokens(
              parsed.usage.prompt_tokens,
              parsed.usage.completion_tokens,
              this.#prices,
            ),
          });
        }
      } catch {
        // Unparseable upstream body: forwarded verbatim, no telemetry row.
      }
    }
    response.writeHead(upstreamResponse.status, {
      'content-type': upstreamResponse.headers.get('content-type') ?? 'application/json',
    });
    response.end(text);
  }
}

/** Hop-by-hop headers never forwarded through either proxy direction. */
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
]);

function forwardableHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const forwarded: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
    forwarded[name] = Array.isArray(value) ? value.join(', ') : value;
  }
  return forwarded;
}

/**
 * Response-direction framing headers never forwarded (finding 10): fetch has
 * already decompressed the body, so the upstream content-encoding/content-
 * length describe bytes that no longer exist.
 */
const RESPONSE_FRAMING_HEADERS = new Set(['content-encoding', 'content-length']);

function forwardableResponseHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const forwarded = forwardableHeaders(headers);
  for (const name of RESPONSE_FRAMING_HEADERS) delete forwarded[name];
  return forwarded;
}

/**
 * Attestation front: serves the well-known test-target JSON (environmentClass
 * local-test, the EXACT proxy origin, a fresh nonce, and the clone-derived
 * build digest) and forwards every other request to the booted app origin.
 * Request AND response headers round-trip (minus hop-by-hop, and minus
 * response framing headers) so cookies and content negotiation survive the
 * crawl. The clone stays pristine — nothing is written into it.
 *
 * Security (dual-review finding 5): the resolved request target's origin MUST
 * equal the app origin. Absolute-form request targets, protocol-relative
 * `//host`, and `/\host` forms all resolve to foreign origins under WHATWG
 * URL semantics — they get a static 404, never a forward.
 */
export class AttestationFront {
  readonly origin: string;
  readonly #server: Server;
  readonly #appOrigin: string;
  readonly #buildDigest: string;
  #stopPromise: Promise<void> | undefined;

  private constructor(server: Server, port: number, appOrigin: string, buildDigest: string) {
    this.#server = server;
    this.origin = `http://127.0.0.1:${port}`;
    this.#appOrigin = new URL(appOrigin).origin;
    this.#buildDigest = buildDigest;
  }

  static async start(options: {
    appOrigin: string;
    buildDigest: string;
  }): Promise<AttestationFront> {
    const server = createHttpServer();
    const port = await listenLoopback(server);
    const front = new AttestationFront(server, port, options.appOrigin, options.buildDigest);
    server.on('request', (request, response) => {
      response.on('error', () => {});
      void front.#handle(request, response);
    });
    return front;
  }

  stop(): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise;
    this.#stopPromise = new Promise<void>((resolveClose) => {
      this.#server.closeIdleConnections();
      this.#server.close(() => resolveClose());
    });
    return this.#stopPromise;
  }

  async #handle(
    request: import('node:http').IncomingMessage,
    response: import('node:http').ServerResponse,
  ): Promise<void> {
    const url = request.url ?? '/';
    if (request.method === 'GET' && url.split('?')[0] === '/.well-known/arxic-test-target.json') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          environmentClass: 'local-test',
          origin: this.origin,
          allowedOrigins: [this.origin],
          buildDigest: this.#buildDigest,
          nonce: randomUUID(),
        }),
      );
      return;
    }
    let upstreamUrl: URL;
    try {
      upstreamUrl = new URL(url, this.#appOrigin);
    } catch {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'ARXIC-DG11-FRONT-ORIGIN' } }));
      return;
    }
    if (upstreamUrl.origin !== this.#appOrigin) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'ARXIC-DG11-FRONT-ORIGIN' } }));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    try {
      const upstream = await fetch(upstreamUrl, {
        method: request.method,
        headers: forwardableHeaders(request.headers),
        ...(body.length > 0 ? { body } : {}),
        redirect: 'manual',
        signal: AbortSignal.timeout(60_000),
      });
      const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
      let text = await upstream.text();
      // #302 (F-E3B): baked-origin SPAs embed ABSOLUTE app-origin URLs in
      // their built HTML (koel: http://<app-origin>/build/...). Through this
      // origin-differing front those loads are cross-origin and CORS-blocked,
      // so the SPA never boots (campaign round 3: crawl shell 0/0/0).
      // Rewrite app-origin absolute URLs to the front origin in HTML bodies
      // (the nginx sub_filter role); other content types pass through.
      if (contentType.includes('text/html')) {
        text = text.split(`${this.#appOrigin}/`).join(`${this.origin}/`);
      }
      const responseHeaders = forwardableResponseHeaders(
        Object.fromEntries(
          [...upstream.headers.entries()].filter(([name]) => name.toLowerCase() !== 'set-cookie'),
        ),
      );
      // #302 (F-E3B): every set-cookie forwards as its OWN header —
      // Object.fromEntries(headers.entries()) keeps only the last one, which
      // silently dropped Laravel's XSRF-TOKEN ahead of the session cookie.
      const setCookies = upstream.headers.getSetCookie();
      response.writeHead(upstream.status, {
        'content-type': contentType,
        ...responseHeaders,
        ...(setCookies.length > 0 ? { 'set-cookie': setCookies } : {}),
      });
      response.end(text);
    } catch {
      response.writeHead(502, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'ARXIC-DG11-APP-UNREACHABLE' } }));
    }
  }
}

/**
 * Sanitize-then-scan a candidate record. Returns the sanitized text and the
 * production scanner's findings OVER THE SANITIZED TEXT: findings non-empty
 * means quarantine — nothing may be written (never ship-then-redact).
 */
export function sanitizeCandidateRecord(
  text: string,
  forbidden: readonly string[],
): { clean: string; findings: readonly { file: string; pattern: string }[] } {
  const clean = sanitizeArtifactJson(text, forbidden);
  const findings = scanTextForSecrets(clean).map((diagnostic) => ({
    file: 'candidate',
    pattern: diagnostic.subject,
  }));
  return { clean, findings };
}

function execute(command: string, args: readonly string[], cwd?: string): Promise<string> {
  return new Promise((resolveCall, rejectCall) => {
    execFile(command, [...args], { encoding: 'utf8', ...(cwd ? { cwd } : {}) }, (error, stdout) => {
      if (error) rejectCall(error);
      else resolveCall(stdout.trim());
    });
  });
}

/** buildDigest = sha256 over the clone's `git rev-parse HEAD^{tree}` output. */
export async function cloneBuildDigest(clonePath: string): Promise<string> {
  const tree = await execute('git', ['rev-parse', 'HEAD^{tree}'], clonePath);
  return sha256(tree);
}

/** The clone's CURRENT HEAD commit — what actually executes, not what is declared. */
export async function cloneHeadCommit(clonePath: string): Promise<string> {
  return execute('git', ['rev-parse', 'HEAD'], clonePath);
}

/**
 * Assert the clone is really at the ratified pin (dual-review finding 8):
 * the record's commit must be OBSERVED at run time, never assumed. Callers
 * refuse (zero spend) unless ok.
 */
export async function assertCloneAtPin(
  clonePath: string,
  expectedPin: string,
): Promise<{ ok: true; head: string } | { ok: false; head: string; expectedPin: string }> {
  const head = await cloneHeadCommit(clonePath);
  return head === expectedPin ? { ok: true, head } : { ok: false, head, expectedPin };
}

function numberFromEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return value;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const preflightOnly = args.includes('--preflight-only');
  const target = args.find((argument) => !argument.startsWith('--'));
  if (!target || !(target in DG11_TARGET_ROW_ESTIMATES)) {
    console.error(
      `usage: dg11-run-validation.ts <${Object.keys(DG11_TARGET_ROW_ESTIMATES).join('|')}> [--preflight-only]`,
    );
    process.exitCode = 2;
    return;
  }
  const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..');
  const evidenceDir = resolve(
    repoRoot,
    process.env.ARXIC_DG11_EVIDENCE_DIR ?? 'docs/evidence/DG-11',
  );
  const targetDir = join(evidenceDir, target);
  const prices: Dg11Prices = {
    promptPerMillion:
      numberFromEnv('ARXIC_DG11_PRICE_PROMPT') ?? DG11_DEFAULT_PRICES.promptPerMillion,
    completionPerMillion:
      numberFromEnv('ARXIC_DG11_PRICE_COMPLETION') ?? DG11_DEFAULT_PRICES.completionPerMillion,
  };
  const estimatedRows =
    numberFromEnv('ARXIC_DG11_ESTIMATED_ROWS') ?? DG11_TARGET_ROW_ESTIMATES[target]!;
  const ledgerPath = join(targetDir, 'spend-ledger.json');
  const runId =
    process.env.ARXIC_DG11_RUN_ID ??
    `dg11-${target}-${new Date().toISOString().replace(/[:.]/gu, '')}`;
  // Finding 11: run ids become path components — validate BEFORE any path use.
  if (!isValidRunId(runId)) {
    console.error(
      `ARXIC_DG11_RUN_ID "${runId}" is invalid: must match ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ (it is used as a path component)`,
    );
    process.exitCode = 2;
    return;
  }

  const preflight = await runPreflightChecks({
    target,
    estimatedRows,
    ledgerPath,
    prices,
    ceilingUsd: numberFromEnv('ARXIC_DG11_CEILING_USD'),
    env: {
      ARXIC_MODEL_BASE_URL: process.env.ARXIC_MODEL_BASE_URL ?? '',
      ARXIC_MODEL_API_KEY: process.env.ARXIC_MODEL_API_KEY ?? '',
    },
  });
  if (preflight.disposition !== 'ok') {
    const refusal = preflight.refusal!;
    await writeArtifactAtomic(
      join(targetDir, 'refusals', `${runId}-${refusal.reason}.json`),
      `${canonicalJson({ ...refusal, runId })}\n`,
    );
    console.error(
      JSON.stringify({ ok: false, refused: refusal.reason, detail: refusal.detail }, null, 1),
    );
    process.exitCode = 1;
    return;
  }
  if (preflightOnly) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          target,
          estimatedRows,
          estimateUsd: preflight.estimateUsd,
          cumulativeUsd: preflight.cumulativeUsd,
          ceilingUsd: preflight.ceilingUsd,
          remainingUsd: preflight.remainingUsd,
        },
        null,
        1,
      ),
    );
    return;
  }
  if (process.env.ARXIC_DG11_CONFIRM_REAL_SPEND !== '1') {
    console.error(
      'refusing to start a REAL spend run: set ARXIC_DG11_CONFIRM_REAL_SPEND=1 to acknowledge model spend',
    );
    process.exitCode = 2;
    return;
  }
  try {
    await runRealValidation({
      target,
      targetDir,
      repoRoot,
      runId,
      prices,
      estimatedRows,
      preflight,
    });
  } catch (error) {
    // Fail-closed with a clean machine-readable error (never a raw stack).
    console.error(
      JSON.stringify(
        { ok: false, error: error instanceof Error ? error.message : String(error) },
        null,
        1,
      ),
    );
    process.exitCode = 1;
  }
}

async function runRealValidation(context: {
  target: string;
  targetDir: string;
  repoRoot: string;
  runId: string;
  prices: Dg11Prices;
  estimatedRows: number;
  preflight: PreflightOutcome;
}): Promise<void> {
  const realKey = process.env.ARXIC_MODEL_API_KEY!.trim();
  const upstream = process.env.ARXIC_MODEL_BASE_URL!.trim().replace(/\/+$/u, '');
  const clonePath = process.env.ARXIC_DG11_TARGET_REPO!;
  const appOrigin = process.env.ARXIC_DG11_TARGET_APP_ORIGIN!;
  const startedAt = new Date().toISOString();
  const dummyCanary = `dg11-canary-${randomUUID()}`;
  const pin = DG11_TARGET_PINS[context.target]!;
  const repository = DG11_TARGET_REPOSITORIES[context.target]!;
  const ledgerPath = join(context.targetDir, 'spend-ledger.json');
  const ceilingUsd = context.preflight.ceilingUsd!;
  const spendBeforeUsd = context.preflight.cumulativeUsd!;

  // Finding 8: the ratified pin is ASSERTED against the clone's real HEAD
  // before anything that can spend starts. Zero upstream calls on refusal.
  const pinCheck = await assertCloneAtPin(clonePath, pin);
  if (!pinCheck.ok) {
    const refusal: RefusalRecord = {
      kind: DG11_RECORD_KIND_REFUSAL,
      schemaVersion: 1,
      target: { name: context.target },
      runId: context.runId,
      at: new Date().toISOString(),
      reason: 'commit-mismatch',
      detail: `clone at ${clonePath} has HEAD ${pinCheck.head}, not the ratified pin ${pinCheck.expectedPin}; checkout the pin and retry — zero model calls placed`,
      upstreamCallsPlaced: 0,
    };
    await writeArtifactAtomic(
      join(context.targetDir, 'refusals', `${context.runId}-commit-mismatch.json`),
      `${canonicalJson(refusal)}\n`,
    );
    console.error(
      JSON.stringify({ ok: false, refused: 'commit-mismatch', detail: refusal.detail }, null, 1),
    );
    process.exitCode = 1;
    return;
  }

  const { runCli } = await import('../../../apps/cli/src/index');
  const outDir = join(context.targetDir, 'runs');
  const configTemplatePath = join(context.targetDir, 'arxic.yaml');
  const configDirectory = await mkdtemp(join(tmpdir(), 'arxic-dg11-config-'));
  const configPath = join(configDirectory, 'arxic.yaml');
  const previousEnv = {
    ARXIC_MODEL_BASE_URL: process.env.ARXIC_MODEL_BASE_URL,
    ARXIC_MODEL_API_KEY: process.env.ARXIC_MODEL_API_KEY,
    ARXIC_MODEL_BUDGET_USD: process.env.ARXIC_MODEL_BUDGET_USD,
  };
  let exitCode: number;
  // Delta re-review P3 (pre-try window): the proxy starts as the LAST
  // statement before the guarded region — every statement after a successful
  // proxy.start() is covered by a finally that stops it, so a throw from
  // cloneBuildDigest or AttestationFront.start can no longer strand the
  // unref'd listener and hang the process instead of exiting 1.
  const proxy = await RecordingModelProxy.start({
    upstreamBaseUrl: upstream,
    upstreamApiKey: realKey,
    // Finding 6: only the child presenting this run's dummy canary may use
    // the proxy — every other local caller gets a static 401.
    inboundBearer: dummyCanary,
    ceilingUsd,
    spendBeforeUsd,
    prices: context.prices,
    runId: context.runId,
  });
  try {
    const buildDigest = await cloneBuildDigest(clonePath);
    const front = await AttestationFront.start({ appOrigin, buildDigest });
    try {
      const template = await readFile(configTemplatePath, 'utf8');
      await writeFile(
        configPath,
        template
          .replaceAll('http://127.0.0.1:DG11-PROXY-PORT', front.origin)
          .replaceAll('DG11-CLONE-PATH', clonePath)
          .replaceAll('DG11-CLONE-COMMIT', pin),
        'utf8',
      );
      process.env.ARXIC_MODEL_BASE_URL = proxy.baseUrl;
      process.env.ARXIC_MODEL_API_KEY = dummyCanary;
      // The pipeline's own pre-call gate must not refuse a legitimately-budgeted
      // run: give it the ledger-derived headroom (the ledger is authoritative).
      process.env.ARXIC_MODEL_BUDGET_USD = String(context.preflight.remainingUsd!);
      const result = await runCli(
        ['run', '--config', configPath, '--out', outDir, '--run-id', context.runId],
        {
          cwd: context.repoRoot,
          rulepacksDir: resolve(context.repoRoot, 'rulepacks'),
        },
      );
      exitCode = result.exitCode;
    } finally {
      for (const [name, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      // Finding 14: BOTH proxies stop on every failure path after start.
      // Finding 3: proxy.stop() drains in-flight upstream forwards first, so
      // a response landing after the child aborted still reaches telemetry.
      await proxy.stop();
      await front.stop();
    }
  } finally {
    // Delta re-review P3 (pre-try window): stop() is idempotent (same
    // #stopPromise), so this is a no-op when the inner finally already
    // stopped the proxy — but it covers throws from cloneBuildDigest /
    // AttestationFront.start that fire before the inner try opens.
    await proxy.stop();
    await rm(configDirectory, { recursive: true, force: true });
  }

  // Harvest: inventory rows (artifacts/13.json), proposals (artifacts/04.json),
  // and the run outcome — honest whatever it is.
  const runRoot = join(outDir, context.runId);
  const coverage = await harvestCoverage(runRoot);
  const outcome = await harvestOutcome(runRoot, exitCode);
  const telemetry = proxy.telemetry.map((call) => ({ ...call }));
  // Finding 3: reconcile forwarded calls vs telemetry AFTER the drain. Any
  // gap means real spend the telemetry cannot account for — the run is
  // invalid and headroom freezes to 0 (fail-closed) until manual repair.
  const accountingGapCalls = Math.max(0, proxy.upstreamHits() - telemetry.length);
  const measuredCostUsd = roundTo9(proxy.measuredSpendUsd() - spendBeforeUsd);
  const at = new Date().toISOString();

  // Finding 2 (post-run half): an unreadable ledger is never silently
  // replaced — the run is reported (spend was incurred), the file preserved
  // byte-for-byte, nothing appended, and the run marked invalid.
  const load = await loadSpendLedger({
    path: ledgerPath,
    target: context.target,
    ceilingUsd,
    repository,
    commit: pin,
  });
  const ledgerReadable = load.status === 'loaded';
  const loadFailure = load.status === 'unreadable' ? load.failure : 'unknown';
  const baseline =
    load.status === 'loaded'
      ? load.ledger
      : emptySpendLedger(context.target, ceilingUsd, { repository, commit: pin });
  const beforeCumulativeUsd = load.status === 'loaded' ? load.ledger.cumulativeUsd : spendBeforeUsd;
  // Finding 4: honest arithmetic — cumulative stays true (may exceed the
  // ceiling by at most one call), remaining clamps to 0, the overshoot event
  // keeps the record self-valid instead of self-invalidating. Gap-aware
  // (delta re-review P3): a non-zero accountingGapCalls freezes
  // after.remainingUsd to 0 so the emitted record passes the validator's
  // accounting-gap freeze rule (recorded cumulative still stays TRUE).
  const finalize = finalizeLedgerArithmetic(
    { cumulativeUsd: beforeCumulativeUsd, ceilingUsd },
    measuredCostUsd,
    accountingGapCalls,
  );
  const events = buildRunEvents({
    refusals: proxy.refusals,
    accountingGapCalls,
    overshootUsd: finalize.overshootUsd,
    at,
  });

  const record: Record<string, unknown> = {
    kind: DG11_RECORD_KIND_RUN,
    schemaVersion: 1,
    target: {
      name: context.target,
      repository,
      commit: pin,
    },
    run: {
      runId: context.runId,
      startedAt,
      completedAt: at,
      executor: 'local',
    },
    model: telemetry[0]?.model ?? DG11_MODEL_SENTINEL,
    pricing: {
      pricePerMillionPrompt: context.prices.promptPerMillion,
      pricePerMillionCompletion: context.prices.completionPerMillion,
      reverifyNote:
        'list prices declared by the operator for this run; the owner re-verifies prices at read time (owner decision 2)',
    },
    telemetry,
    measured: {
      calls: telemetry.length,
      promptTokens: telemetry.reduce((sum, call) => sum + call.promptTokens, 0),
      completionTokens: telemetry.reduce((sum, call) => sum + call.completionTokens, 0),
      latencyMsTotal: telemetry.reduce((sum, call) => sum + call.latencyMs, 0),
      estimatedCostUsd: context.preflight.estimateUsd,
      measuredCostUsd: measuredCostUsd,
    },
    ledger: { before: finalize.before, after: finalize.after },
    coverage,
    outcome,
    events,
    groundednessSpotCheck: {
      status: 'pending',
      note: 'owner (or human delegate) completes the stratified spot-check per docs/evidence/DG-11/README.md; an LLM may not self-grade',
    },
  };
  const candidate = sanitizeCandidateRecord(`${JSON.stringify(record, null, 1)}\n`, [
    realKey,
    dummyCanary,
  ]);
  // The ledger entry is valid ONLY when the ledger was appendable, the
  // accounting reconciled, AND the redaction scan came back clean — a
  // quarantined run keeps its spend but is recorded valid:false (SP-3/SP-4).
  const ledgerAfter = appendSpendLedgerEntry(baseline, {
    runId: context.runId,
    recordedAt: at,
    measuredCostUsd,
    calls: telemetry.length,
    valid: ledgerReadable && accountingGapCalls === 0 && candidate.findings.length === 0,
    ...(accountingGapCalls > 0 ? { accountingGap: true } : {}),
  });
  const remainingUsd = Math.max(0, remainingHeadroomUsd(ledgerAfter));
  if (candidate.findings.length > 0) {
    // C-3/SP-3/SP-4: quarantine — nothing unsanitized is written; the run is
    // invalid; spend is still recorded (it was incurred).
    const quarantine: RefusalRecord = {
      kind: DG11_RECORD_KIND_REFUSAL,
      schemaVersion: 1,
      target: { name: context.target },
      runId: context.runId,
      at,
      reason: 'redaction-finding',
      detail: `post-run scan matched ${candidate.findings
        .map((finding) => finding.pattern)
        .join(
          ', ',
        )}; the run record was quarantined (never written); rotate any exposed credential and rerun`,
      cumulativeUsd: finalize.after.cumulativeUsd,
      ceilingUsd,
      remainingUsd,
      upstreamCallsPlaced: proxy.upstreamHits(),
    };
    if (ledgerReadable) {
      await writeSpendLedgerAtomic(ledgerPath, ledgerAfter);
    }
    await writeArtifactAtomic(
      join(context.targetDir, 'refusals', `${context.runId}-redaction-finding.json`),
      `${canonicalJson(quarantine)}\n`,
    );
    console.error(
      JSON.stringify(
        {
          ok: false,
          quarantined: candidate.findings.map((finding) => finding.pattern),
        },
        null,
        1,
      ),
    );
    process.exitCode = 1;
    return;
  }
  await writeArtifactAtomic(join(outDir, `${context.runId}.json`), candidate.clean);

  if (!ledgerReadable) {
    const refusal: RefusalRecord = {
      kind: DG11_RECORD_KIND_REFUSAL,
      schemaVersion: 1,
      target: { name: context.target },
      runId: context.runId,
      at,
      reason: 'ledger-unreadable',
      detail: `post-run spend-ledger re-read failed (${loadFailure}); path ${ledgerPath}; refused to append — the ledger file is preserved untouched and the run is INVALID until manual repair (docs/evidence/DG-11/README.md); measured spend $${measuredCostUsd.toFixed(9)} over ${telemetry.length} recorded call(s) is NOT in the ledger`,
      cumulativeUsd: finalize.after.cumulativeUsd,
      ceilingUsd,
      remainingUsd: 0,
      upstreamCallsPlaced: proxy.upstreamHits(),
    };
    await writeArtifactAtomic(
      join(context.targetDir, 'refusals', `${context.runId}-ledger-unreadable.json`),
      `${canonicalJson(refusal)}\n`,
    );
    console.error(
      JSON.stringify({ ok: false, refused: 'ledger-unreadable', detail: refusal.detail }, null, 1),
    );
    process.exitCode = 1;
    return;
  }

  await writeSpendLedgerAtomic(ledgerPath, ledgerAfter);
  if (accountingGapCalls > 0) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          accountingGapCalls,
          detail: `${accountingGapCalls} forwarded call(s) produced no telemetry row — run INVALID; remaining headroom frozen to 0 until manual ledger repair (docs/evidence/DG-11/README.md)`,
        },
        null,
        1,
      ),
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        runId: context.runId,
        exitCode,
        calls: telemetry.length,
        measuredCostUsd,
        cumulativeUsd: ledgerAfter.cumulativeUsd,
        remainingUsd,
        coverage,
      },
      null,
      1,
    ),
  );
}

async function harvestCoverage(runRoot: string): Promise<{
  rows: number;
  coveredRows: number;
  proposals: number;
}> {
  const empty = { rows: 0, coveredRows: 0, proposals: 0 };
  let inventory: unknown;
  try {
    inventory = JSON.parse(await readFile(join(runRoot, 'artifacts', '13.json'), 'utf8'));
  } catch {
    return empty;
  }
  let inference: unknown;
  try {
    inference = JSON.parse(await readFile(join(runRoot, 'artifacts', '04.json'), 'utf8'));
  } catch {
    inference = undefined;
  }
  const envelope = inventory as { inventory?: { stats?: { totalRows?: unknown } } };
  const rows =
    typeof envelope.inventory?.stats?.totalRows === 'number'
      ? envelope.inventory.stats.totalRows
      : 0;
  const artifact = inference as {
    proposalRun?: { proposals?: Array<{ inventoryRowIds?: readonly string[] }> };
    candidates?: readonly unknown[];
  };
  const proposals = artifact?.proposalRun?.proposals?.length ?? artifact?.candidates?.length ?? 0;
  const covered = new Set<string>();
  for (const proposal of artifact?.proposalRun?.proposals ?? []) {
    for (const rowId of proposal.inventoryRowIds ?? []) covered.add(rowId);
  }
  return { rows, coveredRows: covered.size, proposals };
}

async function harvestOutcome(
  runRoot: string,
  exitCode: number,
): Promise<{ exitCode: number; status: string; outcome: string; finalStage: string }> {
  try {
    const run = JSON.parse(await readFile(join(runRoot, 'run.json'), 'utf8')) as {
      status?: string;
      outcome?: string;
      stages?: Array<{ stage?: number }>;
    };
    const lastStage = run.stages?.at(-1)?.stage;
    return {
      exitCode,
      status: run.status ?? 'unknown',
      outcome: run.outcome ?? 'unknown',
      finalStage: typeof lastStage === 'number' ? `stage-${lastStage}` : 'unknown',
    };
  } catch {
    return { exitCode, status: 'unknown', outcome: 'unknown', finalStage: 'unknown' };
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  await main();
}
