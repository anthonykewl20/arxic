// DG-03 API-level replay executor (ADR-008 Decision 8). HTTP-level replay for
// non-UI intents against the ATTESTED target, behind the same trust spine as
// the browser verifier:
//   1. target attestation gate (packages/environment) — no business request
//      reaches an unattested or production-looking target;
//   2. policy-engine gate (packages/policy-engine) — HTTP methods map onto the
//      frozen action classes (GET/HEAD → read-only navigation, mutating
//      methods → reversible-mutation with a REQUIRED fixture lease, DELETE →
//      destructive with REQUIRED recorded approval); default-deny on anything
//      else;
//   3. same-origin containment — cross-origin redirects are blocked, never
//      followed;
//   4. per-run fixture reset/seed — missing fixtures stay blocked;
//   5. evidence gates — hashed request/response artifacts with fail-closed
//      redaction (persona secrets, webhook secrets) and post-run hash
//      re-verification;
//   6. classification reuses the REAL @arxic/verifier classifyVerification —
//      identical ordering and semantics as the browser path.
import { createHmac } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArtifactRef, Diagnostic, TruthState } from '@arxic/contracts';
import { sha256 } from '@arxic/contracts';
import {
  EnvironmentHandshake,
  type AttestationDecision,
  type AttestationPolicy,
} from '@arxic/environment';
import { authorize, type HumanApproval, type LeaseState } from '@arxic/policy-engine';
import {
  ARXIC_VERIFY_BLOCKED_FIXTURE,
  ARXIC_VERIFY_SUITE_UNAVAILABLE,
  classifyVerification,
  verifyDiagnostic,
} from '@arxic/verifier';
import {
  ARXIC_DG03_ATTESTATION_REFUSED,
  ARXIC_DG03_ATTESTATION_UNAVAILABLE,
  ARXIC_DG03_ORIGIN_DRIFT,
  ARXIC_DG03_POLICY_DENIED,
  ARXIC_DG03_REDACTION_FAILED,
  dg03Diagnostic,
} from './diagnostics';

export const DG03_API_ARTIFACT_KIND = 'dg03-api-request-response' as const;

const MAX_REDIRECT_HOPS = 5;
const MAX_RETAINED_BODY_BYTES = 8 * 1024;
const SENSITIVE_HEADER_PATTERN =
  /^(cookie|authorization|proxy-authorization|x-arxic-signature|x-hub-signature-256|x-signature|x-api-key)$/i;
const REDACTION_PLACEHOLDER = '[REDACTED]';

export type ApiReplayMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type ApiReplayRequest = Readonly<{
  intent: string;
  method: ApiReplayMethod;
  /** Origin-relative path (may include a query string). */
  path: string;
  headers?: Readonly<Record<string, string>>;
  body?: string;
  /** Env var holding the HMAC secret; the signature never appears in artifacts. */
  hmacSecretEnv?: string;
  /** Header that carries `sha256=<hex>` of the HMAC-SHA256 over the exact body bytes. */
  hmacHeader?: string;
}>;

export type ApiReplayExpectation = Readonly<{
  status?: number;
  bodyContains?: string;
  jsonField?: Readonly<{ path: readonly string[]; equals: unknown }>;
}>;

export type ApiReplayStep = Readonly<{ request: ApiReplayRequest; expect: ApiReplayExpectation }>;

export type ApiReplayInput = {
  runId: string;
  subject: string;
  origin: string;
  steps: readonly ApiReplayStep[];
  requiredRuns: number;
  attestationPolicy?: Readonly<Partial<AttestationPolicy>>;
  lease?: LeaseState;
  approvals?: Readonly<Record<string, HumanApproval>>;
  resetAndSeed: (run: number) => Promise<void>;
  artifactsDir: string;
  forbiddenSubstrings: readonly string[];
  now?: () => string;
};

export type ApiReplayResult = {
  outcome: TruthState;
  runs: Array<{ passed: boolean }>;
  artifacts: ArtifactRef[];
  diagnostics: Diagnostic[];
  attestation?: AttestationDecision;
};

function policyActionFor(
  method: ApiReplayMethod,
): Readonly<{ action: string; actionClass: 'read-only' | 'reversible-mutation' | 'destructive' }> {
  if (method === 'GET' || method === 'HEAD') {
    return { action: 'navigation', actionClass: 'read-only' };
  }
  if (method === 'DELETE') {
    return { action: 'delete-user', actionClass: 'destructive' };
  }
  return { action: 'form-submit', actionClass: 'reversible-mutation' };
}

function redact(value: string, forbidden: readonly string[]): string {
  let redacted = value;
  for (const substring of forbidden) {
    if (substring.length > 0) redacted = redacted.replaceAll(substring, REDACTION_PLACEHOLDER);
  }
  return redacted;
}

function containsForbidden(value: string, forbidden: readonly string[]): string | undefined {
  return forbidden.find((substring) => substring.length > 0 && value.includes(substring));
}

function sanitizeHeader(
  name: string,
  value: string,
  forbidden: readonly string[],
  redactions: { masked: string[] },
): string {
  const sensitive =
    SENSITIVE_HEADER_PATTERN.test(name) || containsForbidden(value, forbidden) !== undefined;
  if (sensitive) {
    redactions.masked.push(name);
    return `sha256:${sha256(value).slice(0, 16)}`;
  }
  return value;
}

function walkJson(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

async function followSameOrigin(
  origin: string,
  initial: Request,
): Promise<{ response: Response; finalUrl: string; hops: number }> {
  let request = initial;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    const response = await fetch(request, { redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return { response, finalUrl: response.url || request.url, hops: hop };
      const next = new URL(location, request.url);
      if (next.origin !== new URL(origin).origin) {
        throw new OriginDriftError(`Redirect left the attested origin: ${next.origin}`);
      }
      request = new Request(next.href, {
        method: request.method === 'HEAD' ? 'HEAD' : request.method,
        headers:
          request.method === 'GET' || request.method === 'HEAD' ? undefined : request.headers,
        body:
          request.method === 'GET' || request.method === 'HEAD'
            ? undefined
            : (await request.clone().text()) || undefined,
        redirect: 'manual',
      });
      continue;
    }
    return { response, finalUrl: response.url || request.url, hops: hop };
  }
  throw new Error(`API replay exceeded ${MAX_REDIRECT_HOPS} redirect hops`);
}

class OriginDriftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OriginDriftError';
  }
}

export async function executeApiReplay(input: ApiReplayInput): Promise<ApiReplayResult> {
  const subject = input.subject;
  const artifacts: ArtifactRef[] = [];
  const runs: Array<{ passed: boolean }> = [];
  const executionDiagnostics: Diagnostic[] = [];
  const artifactFailures: Array<{ reason: 'missing' | 'mismatch'; detail: string }> = [];
  const redactionMasked: string[] = [];

  // Gate 1: target attestation — fail-closed before ANY business request.
  const handshakeResult = await new EnvironmentHandshake().attest(
    { origin: input.origin },
    {
      allowedOrigins: [input.origin],
      allowedEnvironmentClasses: ['local-test'],
      ...input.attestationPolicy,
    },
  );
  const attestation: AttestationDecision | undefined = handshakeResult.decision;
  if (handshakeResult.disposition !== 'allowed') {
    const fetchFailed = handshakeResult.diagnostics.some(
      ({ code }) => code === 'ARXIC-ATTESTATION-FETCH-FAILED',
    );
    return {
      outcome: 'blocked',
      runs,
      artifacts,
      diagnostics: [
        dg03Diagnostic(
          fetchFailed ? ARXIC_DG03_ATTESTATION_UNAVAILABLE : ARXIC_DG03_ATTESTATION_REFUSED,
          'blocked',
          subject,
          `Target attestation ${fetchFailed ? 'could not be fetched' : 'was refused'}: ${handshakeResult.diagnostics.map(({ code }) => code).join(', ')}`,
        ),
      ],
      attestation,
    };
  }

  // Gate 1b: pre-flight redaction — a forbidden substring in a request path can
  // never be redacted without changing the request, so it fails closed here.
  // The same pass rejects any step whose resolved URL leaves the attested
  // origin BEFORE the request is sent (an absolute off-origin `path` must not
  // be fetchable just because redirects are contained).
  const attestedOrigin = new URL(input.origin).origin;
  for (const { request } of input.steps) {
    const leaked = containsForbidden(request.path, input.forbiddenSubstrings);
    if (leaked !== undefined) {
      return {
        outcome: 'blocked',
        runs,
        artifacts,
        diagnostics: [
          dg03Diagnostic(
            ARXIC_DG03_REDACTION_FAILED,
            'blocked',
            subject,
            `Request path of step "${request.intent}" contains a forbidden substring and cannot be redacted`,
          ),
        ],
        attestation,
      };
    }
    let resolved: URL;
    try {
      resolved = new URL(request.path, input.origin);
    } catch {
      return {
        outcome: 'blocked',
        runs,
        artifacts,
        diagnostics: [
          dg03Diagnostic(
            ARXIC_DG03_ORIGIN_DRIFT,
            'blocked',
            subject,
            `Request path of step "${request.intent}" is not a valid origin-relative path`,
          ),
        ],
        attestation,
      };
    }
    if (resolved.origin !== attestedOrigin) {
      return {
        outcome: 'blocked',
        runs,
        artifacts,
        diagnostics: [
          dg03Diagnostic(
            ARXIC_DG03_ORIGIN_DRIFT,
            'blocked',
            subject,
            `Request of step "${request.intent}" resolves off the attested origin: ${resolved.origin}`,
          ),
        ],
        attestation,
      };
    }
  }

  // Gate 2: policy engine — default-deny mapping onto the frozen action classes.
  const policyBudget = { remaining: input.steps.length * Math.max(input.requiredRuns, 1) + 1 };
  for (const { request } of input.steps) {
    const mapped = policyActionFor(request.method);
    const decision = authorize({
      action: mapped.action,
      actionClass: mapped.actionClass,
      origin: input.origin,
      allowedOrigins: [input.origin],
      approvals: { ...input.approvals },
      budget: policyBudget,
      ...(mapped.actionClass === 'reversible-mutation' || mapped.actionClass === 'destructive'
        ? input.lease
          ? { lease: input.lease }
          : {}
        : {}),
      now: Date.parse((input.now ?? (() => new Date().toISOString()))()),
    });
    if (decision.decision === 'deny') {
      return {
        outcome: 'blocked',
        runs,
        artifacts,
        diagnostics: [
          dg03Diagnostic(
            ARXIC_DG03_POLICY_DENIED,
            'blocked',
            subject,
            `Policy denied step "${request.intent}" (${request.method} ${request.path}): ${decision.diagnostics.map(({ code }) => code).join(', ')} — ${decision.reason}`,
          ),
        ],
        attestation,
      };
    }
  }

  await mkdir(input.artifactsDir, { recursive: true });

  for (let run = 1; run <= input.requiredRuns; run += 1) {
    try {
      await input.resetAndSeed(run);
    } catch (error) {
      executionDiagnostics.push(
        verifyDiagnostic(
          ARXIC_VERIFY_BLOCKED_FIXTURE,
          'blocked',
          subject,
          `Clean fixture reset/seed failed before run ${run}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      break;
    }
    const stepResults: Array<{ passed: boolean; failures: string[] }> = [];
    for (const [stepIndex, step] of input.steps.entries()) {
      const outcome = await executeStep(input, run, stepIndex, step, redactionMasked);
      if ('diagnostic' in outcome) {
        executionDiagnostics.push(outcome.diagnostic);
        stepResults.push({ passed: false, failures: [outcome.diagnostic.code] });
        continue;
      }
      artifacts.push(outcome.artifact);
      stepResults.push({ passed: outcome.passed, failures: outcome.failures });
    }
    runs.push({ passed: stepResults.every((result) => result.passed) });
  }

  // Gate 5: hash re-verification of every retained artifact (post-run).
  for (const artifact of artifacts) {
    try {
      const bytes = await readFile(artifact.path);
      const digest = sha256(bytes);
      if (digest !== artifact.sha256) {
        artifactFailures.push({
          reason: 'mismatch',
          detail: `${artifact.path} changed after retention`,
        });
      }
    } catch (error) {
      artifactFailures.push({
        reason: 'missing',
        detail: `${artifact.path} could not be re-read: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  const classification = classifyVerification({
    subject,
    runs,
    policy: { requiredRuns: input.requiredRuns, forbidNetworkErrors: false },
    executionDiagnostics,
    artifactFailures,
  });
  const diagnostics = [...executionDiagnostics, ...classification.diagnostics];
  if (redactionMasked.length > 0) {
    diagnostics.push(
      dg03Diagnostic(
        'ARXIC-DG03-REDACTION-MASKED',
        'observed',
        subject,
        `Redacted sensitive fields: ${[...new Set(redactionMasked)].sort().join(', ')}`,
      ),
    );
  }
  return { outcome: classification.outcome, runs, artifacts, diagnostics, attestation };
}

async function executeStep(
  input: ApiReplayInput,
  run: number,
  stepIndex: number,
  step: ApiReplayStep,
  redactionMasked: string[],
): Promise<
  { artifact: ArtifactRef; passed: boolean; failures: string[] } | { diagnostic: Diagnostic }
> {
  const { request } = step;
  const url = new URL(request.path, input.origin).href;
  const headers: Record<string, string> = { ...(request.headers ?? {}) };
  if (request.body !== undefined && !('content-type' in headers)) {
    headers['content-type'] = 'application/json';
  }
  if (request.hmacSecretEnv && request.hmacHeader) {
    const secret = process.env[request.hmacSecretEnv];
    if (!secret) {
      return {
        diagnostic: verifyDiagnostic(
          ARXIC_VERIFY_SUITE_UNAVAILABLE,
          'blocked',
          input.subject,
          `HMAC secret environment variable ${request.hmacSecretEnv} is not set`,
        ),
      };
    }
    const signature = createHmac('sha256', secret)
      .update(request.body ?? '')
      .digest('hex');
    headers[request.hmacHeader] = `sha256=${signature}`;
  }

  const started = Date.now();
  let response: Response;
  let finalUrl: string;
  try {
    const result = await followSameOrigin(
      input.origin,
      new Request(url, {
        method: request.method,
        headers,
        ...(request.body !== undefined && request.method !== 'GET' && request.method !== 'HEAD'
          ? { body: request.body }
          : {}),
        redirect: 'manual',
      }),
    );
    response = result.response;
    finalUrl = result.finalUrl;
  } catch (error) {
    if (error instanceof OriginDriftError) {
      return {
        diagnostic: dg03Diagnostic(
          ARXIC_DG03_ORIGIN_DRIFT,
          'blocked',
          input.subject,
          `API replay step "${request.intent}" left the attested origin: ${error.message}`,
        ),
      };
    }
    return {
      diagnostic: verifyDiagnostic(
        ARXIC_VERIFY_SUITE_UNAVAILABLE,
        'blocked',
        input.subject,
        `API replay step "${request.intent}" could not execute: ${error instanceof Error ? error.message : String(error)}`,
      ),
    };
  }
  const durationMs = Date.now() - started;

  const rawBody = await response.text().catch(() => '');
  const failures: string[] = [];
  if (step.expect.status !== undefined && response.status !== step.expect.status) {
    failures.push(`expected status ${step.expect.status}, got ${response.status}`);
  }
  const retainedBody = rawBody.slice(0, MAX_RETAINED_BODY_BYTES);
  if (step.expect.bodyContains !== undefined && !retainedBody.includes(step.expect.bodyContains)) {
    failures.push(`body did not contain ${JSON.stringify(step.expect.bodyContains)}`);
  }
  if (step.expect.jsonField) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      failures.push('response body was not JSON');
      parsed = undefined;
    }
    const actual = walkJson(parsed, step.expect.jsonField.path);
    if (JSON.stringify(actual) !== JSON.stringify(step.expect.jsonField.equals)) {
      failures.push(
        `json field ${step.expect.jsonField.path.join('.')} was ${JSON.stringify(actual)}`,
      );
    }
  }

  const artifactRecord = {
    run,
    step: stepIndex,
    intent: request.intent,
    method: request.method,
    url: redact(finalUrl, input.forbiddenSubstrings),
    status: response.status,
    requestHeaders: Object.fromEntries(
      Object.entries(headers).map(([name, value]) => [
        name,
        sanitizeHeader(name, value, input.forbiddenSubstrings, { masked: redactionMasked }),
      ]),
    ),
    ...(request.body !== undefined
      ? {
          requestBody: redact(request.body, input.forbiddenSubstrings).slice(
            0,
            MAX_RETAINED_BODY_BYTES,
          ),
        }
      : {}),
    responseContentType: response.headers.get('content-type') ?? '',
    responseBody: redact(retainedBody, input.forbiddenSubstrings),
    durationMs,
    recordedAt: (input.now ?? (() => new Date().toISOString()))(),
  };
  const serialized = JSON.stringify(artifactRecord, null, 2);
  const leaked = containsForbidden(serialized, input.forbiddenSubstrings);
  if (leaked !== undefined) {
    return {
      diagnostic: dg03Diagnostic(
        ARXIC_DG03_REDACTION_FAILED,
        'blocked',
        input.subject,
        `Retained artifact for step "${request.intent}" still contained a forbidden substring after redaction`,
      ),
    };
  }
  const path = join(
    input.artifactsDir,
    `api-run-${String(run).padStart(2, '0')}-step-${String(stepIndex).padStart(2, '0')}.json`,
  );
  await writeFile(path, serialized, 'utf8');
  const artifact: ArtifactRef = {
    kind: DG03_API_ARTIFACT_KIND,
    path,
    sha256: sha256(serialized),
  };
  return { artifact, passed: failures.length === 0, failures };
}
