import type { Diagnostic } from '@arxic/contracts';
import { ARXIC_COMPILE_ORIGIN_DENIED, compileDiagnostic } from './diagnostics';

export type OriginPolicyResult =
  { passed: true; allowedOrigins: string[] } | { passed: false; diagnostic: Diagnostic };

/** Service-layer normalization used by compile-time and generated runtime policy. */
export function resolveOriginPolicy(input: {
  subject: string;
  declaredOrigin: string;
  /** Additive caller-owned origins permitted alongside the declared target. */
  allowedOrigins?: readonly string[];
  /** Legacy complete approved-origin allowlist. */
  approvedOrigins?: string[];
  runtimeUrl: string;
}): OriginPolicyResult {
  try {
    const declaredOrigin = canonicalOrigin(input.declaredOrigin);
    const allowedOrigins = [
      ...new Set(
        [...(input.approvedOrigins ?? [declaredOrigin]), ...(input.allowedOrigins ?? [])].map(
          canonicalOrigin,
        ),
      ),
    ];
    if (!allowedOrigins.includes(declaredOrigin)) {
      return denied(
        input.subject,
        `Declared origin ${declaredOrigin} is not present in the action-owned approved origin allowlist`,
      );
    }
    const runtimeOrigin = canonicalOrigin(input.runtimeUrl);
    if (!allowedOrigins.includes(runtimeOrigin)) {
      return denied(
        input.subject,
        `Runtime origin ${runtimeOrigin} is not in the approved origin allowlist`,
      );
    }
    return { passed: true, allowedOrigins };
  } catch (error) {
    return denied(
      input.subject,
      `Origin policy contains an invalid URL: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function canonicalOrigin(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new TypeError('origins must be HTTP(S) URLs without userinfo');
  }
  return url.origin;
}

function denied(subject: string, message: string): OriginPolicyResult {
  const diagnostic = compileDiagnostic(ARXIC_COMPILE_ORIGIN_DENIED, subject, message);
  return { passed: false, diagnostic };
}
