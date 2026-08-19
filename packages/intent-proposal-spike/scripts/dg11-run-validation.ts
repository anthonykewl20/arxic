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
 *   ARXIC_DG11_CEILING_USD    per-target cumulative ceiling, default 1.00 (owner decision 1)
 *   ARXIC_DG11_PRICE_PROMPT / ARXIC_DG11_PRICE_COMPLETION  USD per million tokens,
 *                             defaults 0.15 / 0.60 (owner decision 2; re-verify at run time)
 *   ARXIC_DG11_ESTIMATED_ROWS override the per-target measured row estimate
 *   ARXIC_DG11_RUN_ID         record/run id (default dg11-<target>-<utc stamp>)
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
/** Measured route-row counts per ratified target (DG-04 / DG-05 evidence). */
export const DG11_TARGET_ROW_ESTIMATES: Readonly<Record<string, number>> = {
  directus: 272,
  koel: 239,
};
/** Ratified pins (owner decision 3, OBSERVED in the #255 contract). */
export const DG11_TARGET_PINS: Readonly<Record<string, string>> = {
  directus: 'cb846b6a1ddc4811359bc52b74bb31a42eab33db',
  koel: 'dfec91ff290509c622ff7cf392fb5e506841ee2b',
};

export type SpendLedgerEntry = Readonly<{
  runId: string;
  recordedAt: string;
  measuredCostUsd: number;
  calls: number;
  valid: boolean;
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
  'budget-ceiling' | 'credentials-missing' | 'proxy-ceiling' | 'redaction-finding';

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
  disposition: 'ok' | 'refused-budget' | 'refused-credentials';
  estimateUsd: number;
  cumulativeUsd: number;
  ceilingUsd: number;
  remainingUsd: number;
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

export function appendSpendLedgerEntry(ledger: SpendLedger, entry: SpendLedgerEntry): SpendLedger {
  const cumulativeUsd = roundTo9(
    ledger.entries.reduce((sum, item) => sum + item.measuredCostUsd, 0) + entry.measuredCostUsd,
  );
  return { ...ledger, cumulativeUsd, entries: [...ledger.entries, entry] };
}

export async function readSpendLedger(path: string): Promise<SpendLedger> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as SpendLedger;
  if (parsed.schemaVersion !== DG11_SPEND_LEDGER_SCHEMA) {
    throw new Error(`spend ledger at ${path} is not ${DG11_SPEND_LEDGER_SCHEMA}`);
  }
  return parsed;
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
  return roundTo9(ledger.ceilingUsd - ledger.cumulativeUsd);
}

/**
 * Budget-first preflight (G-4/SP-1/SP-2). The budget check runs BEFORE the
 * credential check so the budget boundary is provable with zero credentials
 * and zero spend. No side effects: the caller writes the refusal record.
 */
export async function runPreflightChecks(input: {
  target: string;
  estimatedRows: number;
  ledgerPath: string;
  prices: Dg11Prices;
  env: { ARXIC_MODEL_BASE_URL: string; ARXIC_MODEL_API_KEY: string };
  ceilingUsd?: number;
  now?: () => string;
}): Promise<PreflightOutcome> {
  const now = input.now ?? (() => new Date().toISOString());
  let ledger: SpendLedger;
  try {
    ledger = await readSpendLedger(input.ledgerPath);
  } catch {
    ledger = emptySpendLedger(input.target, input.ceilingUsd ?? DG11_DEFAULT_CEILING_USD, {});
  }
  const estimateUsd = roundTo9(estimateRunCostUsd(input.estimatedRows, input.prices));
  const remainingUsd = remainingHeadroomUsd(ledger);
  const base = {
    estimateUsd,
    cumulativeUsd: ledger.cumulativeUsd,
    ceilingUsd: ledger.ceilingUsd,
    remainingUsd,
  };
  if (remainingUsd + 1e-9 < estimateUsd) {
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
        detail: `remaining headroom $${remainingUsd.toFixed(6)} is below the estimated run cost $${estimateUsd.toFixed(6)}; zero model calls placed`,
        estimateUsd,
        cumulativeUsd: ledger.cumulativeUsd,
        ceilingUsd: ledger.ceilingUsd,
        remainingUsd,
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
        remainingUsd,
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
 */
export class RecordingModelProxy {
  readonly baseUrl: string;
  readonly telemetry: TelemetryCall[] = [];
  readonly refusals: RefusalRecord[] = [];
  readonly #server: Server;
  readonly #upstream: string;
  readonly #upstreamKey: string;
  readonly #ceilingUsd: number;
  readonly #spendBeforeUsd: number;
  readonly #prices: Dg11Prices;
  readonly #runId: string;
  #forwards = 0;
  #stopped = false;

  private constructor(
    server: Server,
    upstream: string,
    upstreamKey: string,
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
    this.#ceilingUsd = ceilingUsd;
    this.#spendBeforeUsd = spendBeforeUsd;
    this.#prices = prices;
    this.#runId = runId;
  }

  static async start(options: {
    upstreamBaseUrl: string;
    upstreamApiKey: string;
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
      options.ceilingUsd,
      options.spendBeforeUsd,
      options.prices,
      options.runId ?? 'dg11-proxy',
      port,
    );
    server.on('request', (request, response) => {
      void proxy.#handle(request, response);
    });
    return proxy;
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
    if (this.#stopped) return Promise.resolve();
    this.#stopped = true;
    return new Promise<void>((resolveClose) => this.#server.close(() => resolveClose()));
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
 * Attestation front: serves the well-known test-target JSON (environmentClass
 * local-test, the EXACT proxy origin, a fresh nonce, and the clone-derived
 * build digest) and forwards every other request to the booted app origin.
 * Request AND response headers round-trip (minus hop-by-hop) so cookies and
 * content negotiation survive the crawl. The clone stays pristine — nothing
 * is written into it.
 */
export class AttestationFront {
  readonly origin: string;
  readonly #server: Server;
  readonly #appOrigin: string;
  readonly #buildDigest: string;
  #stopped = false;

  private constructor(server: Server, port: number, appOrigin: string, buildDigest: string) {
    this.#server = server;
    this.origin = `http://127.0.0.1:${port}`;
    this.#appOrigin = appOrigin;
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
      void front.#handle(request, response);
    });
    return front;
  }

  stop(): Promise<void> {
    if (this.#stopped) return Promise.resolve();
    this.#stopped = true;
    return new Promise<void>((resolveClose) => this.#server.close(() => resolveClose()));
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
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    try {
      const upstream = await fetch(new URL(url, this.#appOrigin), {
        method: request.method,
        headers: forwardableHeaders(request.headers),
        ...(body.length > 0 ? { body } : {}),
        redirect: 'manual',
        signal: AbortSignal.timeout(60_000),
      });
      const text = await upstream.text();
      const responseHeaders = forwardableHeaders(Object.fromEntries(upstream.headers.entries()));
      response.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
        ...responseHeaders,
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

  const preflight = await runPreflightChecks({
    target,
    estimatedRows,
    ledgerPath,
    prices,
    ceilingUsd: numberFromEnv('ARXIC_DG11_CEILING_USD') ?? DG11_DEFAULT_CEILING_USD,
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
  const { runCli } = await import('../../../apps/cli/src/index');

  const proxy = await RecordingModelProxy.start({
    upstreamBaseUrl: upstream,
    upstreamApiKey: realKey,
    ceilingUsd: context.preflight.ceilingUsd,
    spendBeforeUsd: context.preflight.cumulativeUsd,
    prices: context.prices,
    runId: context.runId,
  });
  const buildDigest = await cloneBuildDigest(clonePath);
  const front = await AttestationFront.start({ appOrigin, buildDigest });
  const outDir = join(context.targetDir, 'runs');
  const configTemplatePath = join(context.targetDir, 'arxic.yaml');
  const configDirectory = await mkdtemp(join(tmpdir(), 'arxic-dg11-config-'));
  const configPath = join(configDirectory, 'arxic.yaml');
  const template = await readFile(configTemplatePath, 'utf8');
  const commit = DG11_TARGET_PINS[context.target]!;
  await writeFile(
    configPath,
    template
      .replaceAll('http://127.0.0.1:DG11-PROXY-PORT', front.origin)
      .replaceAll('DG11-CLONE-PATH', clonePath)
      .replaceAll('DG11-CLONE-COMMIT', commit),
    'utf8',
  );

  const previousEnv = {
    ARXIC_MODEL_BASE_URL: process.env.ARXIC_MODEL_BASE_URL,
    ARXIC_MODEL_API_KEY: process.env.ARXIC_MODEL_API_KEY,
    ARXIC_MODEL_BUDGET_USD: process.env.ARXIC_MODEL_BUDGET_USD,
  };
  process.env.ARXIC_MODEL_BASE_URL = proxy.baseUrl;
  process.env.ARXIC_MODEL_API_KEY = dummyCanary;
  // The pipeline's own pre-call gate must not refuse a legitimately-budgeted
  // run: give it the ledger-derived headroom (the ledger is authoritative).
  process.env.ARXIC_MODEL_BUDGET_USD = String(context.preflight.remainingUsd);
  let exitCode: number;
  try {
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
    await Promise.all([proxy.stop(), front.stop()]);
    await rm(configDirectory, { recursive: true, force: true });
  }

  // Harvest: inventory rows (artifacts/13.json), proposals (artifacts/04.json),
  // and the run outcome — honest whatever it is.
  const runRoot = join(outDir, context.runId);
  const coverage = await harvestCoverage(runRoot);
  const outcome = await harvestOutcome(runRoot, exitCode);
  const measuredCostUsd = roundTo9(proxy.measuredSpendUsd() - context.preflight.cumulativeUsd);
  const telemetry = proxy.telemetry.map((call) => ({ ...call }));
  const events = proxy.refusals.map((refusal) => ({
    type: 'refusal' as const,
    at: refusal.at,
    detail: refusal.detail,
  }));

  let ledger: SpendLedger;
  try {
    ledger = await readSpendLedger(join(context.targetDir, 'spend-ledger.json'));
  } catch {
    ledger = emptySpendLedger(context.target, context.preflight.ceilingUsd, {
      repository: `https://github.com/${context.target}/${context.target}`,
      commit: DG11_TARGET_PINS[context.target]!,
    });
  }
  const ledgerBefore = {
    cumulativeUsd: ledger.cumulativeUsd,
    ceilingUsd: ledger.ceilingUsd,
    remainingUsd: remainingHeadroomUsd(ledger),
  };
  const record: Record<string, unknown> = {
    kind: DG11_RECORD_KIND_RUN,
    schemaVersion: 1,
    target: {
      name: context.target,
      repository: ledger.repository ?? `https://github.com/${context.target}/${context.target}`,
      commit: DG11_TARGET_PINS[context.target]!,
    },
    run: {
      runId: context.runId,
      startedAt,
      completedAt: new Date().toISOString(),
      executor: 'local',
    },
    model: telemetry[0]?.model ?? 'openai/gpt-4o-mini',
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
    ledger: {
      before: ledgerBefore,
      after: {
        cumulativeUsd: roundTo9(ledgerBefore.cumulativeUsd + measuredCostUsd),
        ceilingUsd: ledger.ceilingUsd,
        remainingUsd: roundTo9(ledger.ceilingUsd - ledgerBefore.cumulativeUsd - measuredCostUsd),
      },
    },
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
  if (candidate.findings.length > 0) {
    // C-3/SP-3/SP-4: quarantine — nothing unsanitized is written; the run is
    // invalid; spend is still recorded (it was incurred).
    const quarantine: RefusalRecord = {
      kind: DG11_RECORD_KIND_REFUSAL,
      schemaVersion: 1,
      target: { name: context.target },
      runId: context.runId,
      at: new Date().toISOString(),
      reason: 'redaction-finding',
      detail: `post-run scan matched ${candidate.findings
        .map((finding) => finding.pattern)
        .join(
          ', ',
        )}; the run record was quarantined (never written); rotate any exposed credential and rerun`,
      cumulativeUsd: roundTo9(ledgerBefore.cumulativeUsd + measuredCostUsd),
      ceilingUsd: ledger.ceilingUsd,
      remainingUsd: roundTo9(ledger.ceilingUsd - ledgerBefore.cumulativeUsd - measuredCostUsd),
      upstreamCallsPlaced: proxy.upstreamHits(),
    };
    ledger = appendSpendLedgerEntry(ledger, {
      runId: context.runId,
      recordedAt: new Date().toISOString(),
      measuredCostUsd: measuredCostUsd,
      calls: telemetry.length,
      valid: false,
    });
    await writeSpendLedgerAtomic(join(context.targetDir, 'spend-ledger.json'), ledger);
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
  ledger = appendSpendLedgerEntry(ledger, {
    runId: context.runId,
    recordedAt: new Date().toISOString(),
    measuredCostUsd: measuredCostUsd,
    calls: telemetry.length,
    valid: true,
  });
  await writeSpendLedgerAtomic(join(context.targetDir, 'spend-ledger.json'), ledger);
  console.log(
    JSON.stringify(
      {
        ok: true,
        runId: context.runId,
        exitCode,
        calls: telemetry.length,
        measuredCostUsd,
        cumulativeUsd: ledger.cumulativeUsd,
        remainingUsd: remainingHeadroomUsd(ledger),
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
