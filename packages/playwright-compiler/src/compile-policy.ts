import type { Diagnostic, Workflow } from '@arxic/contracts';
import {
  ARXIC_COMPILE_FORBIDDEN_API,
  ARXIC_COMPILE_LOCATOR_NONSEMANTIC,
  ARXIC_COMPILE_SECRET_EXPOSURE,
  compileDiagnostic,
} from './diagnostics';

export type CompilePolicyInput = {
  spec: string;
  fixture: string;
  workflow: Workflow;
  nonSemanticLocatorDiagnostics?: Diagnostic[];
  /**
   * #314 (F-E10): fixed package-owned runtime sources embedded verbatim in
   * every bundle (transition receipts, screenshot privacy). Forbidden-API
   * and secret scans still cover them byte-for-byte, but the per-workflow
   * non-semantic LOCATOR review does not: those bytes are identical for
   * every workflow, are hash-bound by the verifier, and are reviewed as
   * package source — a per-workflow scan adds no signal while forcing
   * every workflow to carry a locator rationale for code it never chose.
   */
  fixedRuntimeSources?: readonly string[];
};

export type CompilePolicyResult = { passed: true } | { passed: false; diagnostics: Diagnostic[] };

export function enforceCompilePolicy(input: CompilePolicyInput): CompilePolicyResult {
  const source = `${input.spec}\n${input.fixture}\n${(input.fixedRuntimeSources ?? []).join('\n')}`;
  const generatedSource = `${input.spec}\n${input.fixture}`;
  const diagnostics: Diagnostic[] = [];
  for (const forbidden of ['waitForTimeout', 'waitForLoadState', 'page.evaluate']) {
    if (source.includes(forbidden)) {
      diagnostics.push(
        compileDiagnostic(
          ARXIC_COMPILE_FORBIDDEN_API,
          'generated-source',
          `Generated source uses forbidden API ${forbidden}`,
        ),
      );
    }
  }
  const hasRationale = input.nonSemanticLocatorDiagnostics?.some(
    (diagnostic) =>
      diagnostic.code === ARXIC_COMPILE_LOCATOR_NONSEMANTIC &&
      diagnostic.severity === 'blocked' &&
      diagnostic.message.trim().length > 0,
  );
  const unapprovedLocators = findUnapprovedNonSemanticLocators(
    generatedSource,
    Boolean(hasRationale),
  );
  if (unapprovedLocators.length > 0) {
    diagnostics.push(
      compileDiagnostic(
        ARXIC_COMPILE_LOCATOR_NONSEMANTIC,
        'generated-source',
        `Generated source uses unapproved non-semantic locator pattern(s): ${unapprovedLocators.join(', ')}. A reviewed rationale only covers the exact form-scope page.locator('form') shape`,
      ),
    );
  }
  const exposed = sensitiveValues(input.workflow).find((value) => source.includes(value));
  const containsEmail = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(source);
  if (exposed || containsEmail) {
    diagnostics.push(
      compileDiagnostic(
        ARXIC_COMPILE_SECRET_EXPOSURE,
        'generated-source',
        'Generated source contains a literal secret or personal-data value',
      ),
    );
  }
  return diagnostics.length === 0 ? { passed: true } : { passed: false, diagnostics };
}

function findUnapprovedNonSemanticLocators(source: string, hasRationale: boolean): string[] {
  const usages = new Set<string>();
  for (const match of source.matchAll(/page\.locator\s*\(\s*([^)]*)\)/gu)) {
    const argument = match[1]?.trim() ?? '';
    if (!hasRationale || !/^(['"`])form\1$/u.test(argument)) {
      usages.add(`page.locator(${argument || '…'})`);
    }
  }
  for (const match of source.matchAll(/(page\.\$\$?)\s*\(\s*([^)]*)\)/gu)) {
    usages.add(`${match[1]}(${match[2]?.trim() || '…'})`);
  }
  if (/xpath\s*=/iu.test(source)) usages.add('xpath=');
  for (const match of source.matchAll(/(?<![\w.])locator\(\s*(['"`])([#.[/])/gu)) {
    usages.add(`locator(${match[1]}${match[2]}…)`);
  }
  return [...usages];
}

function sensitiveValues(workflow: Workflow): string[] {
  const values: string[] = [];
  for (const precondition of workflow.preconditions) {
    collectSensitiveValues(precondition.parameters, values);
  }
  for (const transition of workflow.transitions) {
    collectSensitiveValues(transition.action.intent, values, 'action');
    for (const assertion of transition.assertions) {
      collectSensitiveValues(assertion.intent, values, 'assertion');
    }
  }
  return values.filter((value) => value.length >= 3);
}

function collectSensitiveValues(value: unknown, target: string[], key = ''): void {
  if (typeof value === 'string') {
    const keySensitive = /email|password|secret|token|phone|name/iu.test(key);
    const assignments =
      value.match(/(?:token|password|secret|apikey|api_key|credential)\s*[=:]\s*[^\s'"`]+/giu) ??
      [];
    if (keySensitive || value.includes('@')) target.push(value);
    target.push(...assignments);
    return;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const [childKey, childValue] of Object.entries(value)) {
    collectSensitiveValues(childValue, target, childKey);
  }
}
