import type { Diagnostic } from '@arxic/contracts';
import { defaultQuotas, workerDiagnostic, type WorkerQuotas } from '@arxic/environment';
import type { RunSpec } from './run-spec';

export type RunPolicy = Readonly<{
  allowedOrigins: readonly string[];
  externalNetwork: 'deny';
  mutation: 'leased-fixtures-only';
  quotas: WorkerQuotas;
}>;

type Finding = Readonly<{ path: string; reason: string }>;

const daemonEnvironment = /^DOCKER_(HOST|CONTEXT|TLS.*|CERT_PATH)$/i;
const socketPath = /(?:^|[/\\])[^/\\]*\.sock(?:$|[:/\\])/i;
const credentialPath =
  /(?:^|[/\\])(?:\.ssh|\.aws|\.config[/\\]gcloud|root)(?:$|[/\\])|[/\\]etc[/\\](?:ssh|shadow|passwd)|id_rsa|credentials/i;
const unsafeDockerFlag =
  /(?:^|\s)--privileged(?:=true)?(?:\s|$)|--network(?:=|\s+)host(?:\s|$)|--user(?:=|\s+)(?:root|0)(?::\S*)?(?:\s|$)|--cap-add(?:=|\s+)\S+/i;

function normalizedKey(key: string): string {
  return key.replaceAll(/[-_]/g, '').toLowerCase();
}

function visit(value: unknown, path: string, findings: Finding[]): void {
  if (typeof value === 'string') {
    if (socketPath.test(value)) findings.push({ path, reason: 'daemon or other socket path' });
    if (credentialPath.test(value)) findings.push({ path, reason: 'host credential path' });
    if (/169\.254\.169\.254/.test(value))
      findings.push({ path, reason: 'cloud metadata endpoint' });
    if (/mount/i.test(path) && /(?:^|:)~?(?:[/\\])?home(?:[/\\]|$)/i.test(value))
      findings.push({ path, reason: 'host home mount' });
    if (
      /mount/i.test(path) &&
      /(?:^|,)target=\/work\/source(?:,|$)|:\/work\/source(?::|$)/i.test(value) &&
      !/(?:^|,)(?:readonly|ro)(?:,|$)|:ro(?:$|,)/i.test(value)
    )
      findings.push({ path, reason: 'writable source mount' });
    if (unsafeDockerFlag.test(value)) findings.push({ path, reason: 'unsafe Docker flag' });
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    const joined = value.map(String).join(' ');
    if (unsafeDockerFlag.test(joined)) findings.push({ path, reason: 'unsafe Docker arguments' });
    if (/\bDOCKER_(?:HOST|CONTEXT|TLS_VERIFY|CERT_PATH)=/i.test(joined))
      findings.push({ path, reason: 'Docker daemon environment' });
    value.forEach((entry, index) => visit(entry, `${path}[${index}]`, findings));
    return;
  }

  const record = value as Record<string, unknown>;
  for (const [key, entry] of Object.entries(record)) {
    const keyPath = path ? `${path}.${key}` : key;
    const keyName = normalizedKey(key);
    if (daemonEnvironment.test(key) && entry !== undefined && entry !== '') {
      findings.push({ path: keyPath, reason: 'Docker daemon environment' });
    }
    if (keyName === 'privileged' && (entry === true || String(entry).toLowerCase() === 'true')) {
      findings.push({ path: keyPath, reason: 'privileged mode' });
    }
    if (
      (keyName === 'network' || keyName === 'networkmode') &&
      String(entry).toLowerCase() === 'host'
    ) {
      findings.push({ path: keyPath, reason: 'host network' });
    }
    if (
      (keyName === 'user' || keyName === 'uid') &&
      (entry === 0 || /^(?:root|0)(?::\S*)?$/i.test(String(entry)))
    ) {
      findings.push({ path: keyPath, reason: 'root user' });
    }
    if (keyName === 'capadd') {
      const capabilities = Array.isArray(entry) ? entry : [entry];
      if (capabilities.some((capability) => String(capability).length > 0)) {
        findings.push({ path: keyPath, reason: 'dangerous Linux capability' });
      }
    }
    visit(entry, keyPath, findings);
  }

  const normalized = new Map(
    Object.entries(record).map(([key, value]) => [normalizedKey(key), value]),
  );
  const target = normalized.get('target') ?? normalized.get('destination') ?? normalized.get('dst');
  if (target === '/work/source') {
    const readOnly = normalized.get('readonly') ?? normalized.get('ro');
    if (readOnly !== true && readOnly !== 'true' && readOnly !== 'ro') {
      findings.push({ path, reason: 'writable source mount' });
    }
  }
}

export function validateWorkerSecurity(
  spec: RunSpec,
): { ok: true } | { ok: false; diagnostics: Diagnostic[] } {
  const findings: Finding[] = [];
  visit(spec, '', findings);
  if (!/^[A-Za-z0-9_.-]+$/.test(spec.runId))
    findings.push({ path: 'runId', reason: 'unsafe resource identifier' });
  if (spec.config.policy.externalNetwork !== 'deny')
    findings.push({
      path: 'config.policy.externalNetwork',
      reason: 'external network must be denied',
    });
  if (spec.config.policy.mutation !== 'leased-fixtures-only')
    findings.push({ path: 'config.policy.mutation', reason: 'mutation must be lease-scoped' });
  if (
    !Number.isFinite(spec.config.policy.maxRuntimeMinutes) ||
    spec.config.policy.maxRuntimeMinutes <= 0
  )
    findings.push({
      path: 'config.policy.maxRuntimeMinutes',
      reason: 'runtime quota must be positive and finite',
    });
  if (findings.length === 0) return { ok: true };
  return {
    ok: false,
    diagnostics: [
      workerDiagnostic(
        'ARXIC-WORKER-CONFIG-UNSAFE',
        spec.runId,
        `Unsafe worker configuration refused: ${findings.map(({ path, reason }) => `${path} (${reason})`).join(', ')}`,
      ),
    ],
  };
}

export function freezePolicy(spec: RunSpec): RunPolicy {
  const allowedOrigins = Object.freeze([...spec.config.target.allowedOrigins]);
  return Object.freeze({
    allowedOrigins,
    externalNetwork: 'deny' as const,
    mutation: 'leased-fixtures-only' as const,
    quotas: Object.freeze(defaultQuotas(spec.config.policy.maxRuntimeMinutes)),
  });
}

const injectionDirective =
  /allow-origin\s*=|action\s*=\s*destructive|ignore[^\n.]{0,80}policy|run\s+(?:this\s+)?command|run\s*:|<\/?system\b/i;

export function ingestContentAsData(
  policy: RunPolicy,
  content: string,
  source: string,
): { policy: RunPolicy; diagnostics: Diagnostic[] } {
  if (!injectionDirective.test(content)) return { policy, diagnostics: [] };
  return {
    policy,
    diagnostics: [
      workerDiagnostic(
        'ARXIC-WORKER-INJECTION-NEUTRALIZED',
        source,
        'Injection-shaped content was treated as data and did not modify run policy.',
        'observed',
      ),
    ],
  };
}
