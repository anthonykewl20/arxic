import type { Diagnostic } from '@arxic/contracts';
import {
  ARXIC_ATTESTATION_ENV_CLASS_DENIED,
  ARXIC_ATTESTATION_FETCH_FAILED,
  ARXIC_ATTESTATION_NONCE_MISMATCH,
  ARXIC_ATTESTATION_ORIGIN_NOT_ALLOWED,
  ARXIC_ATTESTATION_OVERRIDE_MISSING,
  ARXIC_ATTESTATION_PRODUCTION_LIKING,
  ARXIC_ATTESTATION_RECEIPT_UNSIGNED,
  attestationDiagnostic,
} from './diagnostics';
import { fetchAttestation, validSignedReceipt, type TargetAttestation } from './service';

export const PACKAGE_NAME = '@arxic/environment' as const;
export const ATTESTATION_POLICY_VERSION = 'arxic-target-attestation-v1' as const;
const BUILD_DIGEST_MISMATCH = 'ARXIC-ATTESTATION-BUILD-DIGEST-MISMATCH' as const;

export type HumanApproval = {
  approver: string;
  approvedAt: string;
  reason: string;
};

export type AttestationPolicy = {
  allowedOrigins: string[];
  /** Loopback/reference targets may be explicitly admitted without weakening non-local policy. */
  localTestAllowedOrigins?: string[];
  allowedEnvironmentClasses?: string[];
  expectedNonce?: string;
  expectedBuildDigest?: string;
  requireSignedReceipt?: boolean;
  receiptKey?: string;
  humanApprovals?: Record<string, HumanApproval>;
  attestationTimeoutMs?: number;
  now?: () => string;
};

export type AttestationDecision = {
  target: string;
  origin: string;
  environmentClass: string;
  buildDigest?: string;
  disposition: 'allowed' | 'refused';
  reason: string;
  policyVersion: string;
  timestamp: string;
  override?: HumanApproval;
};

export type AttestationResult = {
  ok: boolean;
  disposition: 'allowed' | 'refused';
  diagnostics: Diagnostic[];
  decision: AttestationDecision;
};

export type AttestationRequest = { origin: string };

export type TargetClassification = {
  productionLooking: boolean;
  reasons: Array<'production-environment-class' | 'public-hostname'>;
};

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

export function classifyTarget(target: {
  origin: string;
  environmentClass: string;
}): TargetClassification {
  const reasons: TargetClassification['reasons'] = [];
  if (/production|prod/i.test(target.environmentClass)) {
    reasons.push('production-environment-class');
  }
  let hostname = '';
  try {
    hostname = new URL(target.origin).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    reasons.push('public-hostname');
    return { productionLooking: true, reasons };
  }
  const safeHostname =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    isPrivateIpv4(hostname) ||
    /\.(?:test|example|local)$/i.test(hostname);
  if (!safeHostname) reasons.push('public-hostname');
  return { productionLooking: reasons.length > 0, reasons };
}

function isExactWebOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.origin === origin
    );
  } catch {
    return false;
  }
}

function decision(
  request: AttestationRequest,
  environmentClass: string,
  disposition: AttestationDecision['disposition'],
  reason: string,
  policy: AttestationPolicy,
  override?: HumanApproval,
  buildDigest?: string,
): AttestationDecision {
  return {
    target: request.origin,
    origin: request.origin,
    environmentClass,
    ...(buildDigest ? { buildDigest } : {}),
    disposition,
    reason,
    policyVersion: ATTESTATION_POLICY_VERSION,
    timestamp: (policy.now ?? (() => new Date().toISOString()))(),
    ...(override ? { override } : {}),
  };
}

function isHumanApproval(value: unknown): value is HumanApproval {
  if (typeof value !== 'object' || value === null) return false;
  const approval = value as Record<string, unknown>;
  return (
    typeof approval.approver === 'string' &&
    approval.approver.length > 0 &&
    typeof approval.approvedAt === 'string' &&
    approval.approvedAt.length > 0 &&
    typeof approval.reason === 'string' &&
    approval.reason.length > 0
  );
}

export function verifyAttestation(
  attestation: TargetAttestation,
  request: AttestationRequest,
  policy: AttestationPolicy,
): AttestationResult {
  const diagnostics: Diagnostic[] = [];
  const classification = classifyTarget(attestation);
  const override: unknown = policy.humanApprovals?.[request.origin];
  const validOverride = isHumanApproval(override) ? override : undefined;
  const approvedProductionOverride = classification.productionLooking ? validOverride : undefined;
  if (classification.productionLooking && !approvedProductionOverride) {
    diagnostics.push(
      attestationDiagnostic(
        ARXIC_ATTESTATION_PRODUCTION_LIKING,
        request.origin,
        `Target looks production-like: ${classification.reasons.join(', ')}`,
      ),
      attestationDiagnostic(
        ARXIC_ATTESTATION_OVERRIDE_MISSING,
        request.origin,
        'Production-looking targets require a recorded human approval',
      ),
    );
  }
  const authoritativeOrigins =
    attestation.environmentClass === 'local-test'
      ? (policy.localTestAllowedOrigins ?? policy.allowedOrigins)
      : policy.allowedOrigins;
  if (
    !isExactWebOrigin(request.origin) ||
    !isExactWebOrigin(attestation.origin) ||
    request.origin !== attestation.origin ||
    !authoritativeOrigins.includes(request.origin)
  ) {
    diagnostics.push(
      attestationDiagnostic(
        ARXIC_ATTESTATION_ORIGIN_NOT_ALLOWED,
        request.origin,
        'Request and attested origins must match an independent operator allowlist exactly',
      ),
    );
  }
  const allowedClasses = policy.allowedEnvironmentClasses ?? ['local-test', 'preview'];
  if (!allowedClasses.includes(attestation.environmentClass) && !approvedProductionOverride) {
    diagnostics.push(
      attestationDiagnostic(
        ARXIC_ATTESTATION_ENV_CLASS_DENIED,
        request.origin,
        `Environment class ${attestation.environmentClass} is denied`,
      ),
    );
  }
  if (policy.expectedNonce !== undefined && attestation.nonce !== policy.expectedNonce) {
    diagnostics.push(
      attestationDiagnostic(
        ARXIC_ATTESTATION_NONCE_MISMATCH,
        request.origin,
        'Attestation nonce does not match the expected nonce',
      ),
    );
  }
  if (attestation.environmentClass !== 'local-test' && policy.expectedNonce === undefined) {
    diagnostics.push(
      attestationDiagnostic(
        ARXIC_ATTESTATION_NONCE_MISMATCH,
        request.origin,
        'Non-local attestation requires an independently issued expected nonce',
      ),
    );
  }
  if (
    policy.expectedBuildDigest !== undefined
      ? attestation.buildDigest.toLowerCase() !== policy.expectedBuildDigest.toLowerCase()
      : attestation.environmentClass !== 'local-test'
  ) {
    diagnostics.push({
      code: BUILD_DIGEST_MISMATCH,
      severity: 'blocked',
      subject: request.origin,
      message:
        policy.expectedBuildDigest === undefined
          ? 'Non-local attestation requires an independently discovered build digest'
          : 'Attested build digest does not match the discovered or staged source digest',
    });
  }
  if (
    (attestation.environmentClass !== 'local-test' || policy.requireSignedReceipt === true) &&
    (!policy.receiptKey || !validSignedReceipt(attestation, policy.receiptKey))
  ) {
    diagnostics.push(
      attestationDiagnostic(
        ARXIC_ATTESTATION_RECEIPT_UNSIGNED,
        request.origin,
        'A valid HMAC-SHA256 build receipt is required',
      ),
    );
  }
  const disposition = diagnostics.length === 0 ? 'allowed' : 'refused';
  let reason = diagnostics.map((item) => item.code).join(', ');
  if (disposition === 'allowed') {
    reason = approvedProductionOverride
      ? 'Recorded human approval accepted for production-looking target'
      : 'Target attestation satisfies policy';
  }
  return {
    ok: disposition === 'allowed',
    disposition,
    diagnostics,
    decision: {
      ...decision(
        request,
        attestation.environmentClass,
        disposition,
        reason,
        policy,
        disposition === 'allowed' ? approvedProductionOverride : undefined,
        attestation.buildDigest,
      ),
      origin: attestation.origin,
    },
  };
}

export class EnvironmentHandshake {
  async attest(
    request: AttestationRequest,
    policy: AttestationPolicy,
  ): Promise<Omit<AttestationResult, 'ok'>> {
    try {
      const result = verifyAttestation(
        await fetchAttestation(request.origin, policy.attestationTimeoutMs),
        request,
        policy,
      );
      return {
        disposition: result.disposition,
        decision: result.decision,
        diagnostics: result.diagnostics,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const diagnostics = [
        attestationDiagnostic(
          ARXIC_ATTESTATION_FETCH_FAILED,
          request.origin,
          `Could not fetch or validate target attestation: ${message}`,
        ),
      ];
      return {
        disposition: 'refused',
        diagnostics,
        decision: decision(request, 'unknown', 'refused', diagnostics[0].code, policy),
      };
    }
  }
}

export * from './diagnostics';
export { type TargetAttestation } from './service';
