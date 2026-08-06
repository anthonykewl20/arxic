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
};

export type CompilePolicyResult = { passed: true } | { passed: false; diagnostics: Diagnostic[] };

export function enforceCompilePolicy(input: CompilePolicyInput): CompilePolicyResult {
  const source = `${input.spec}\n${input.fixture}`;
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
  const hasNonSemanticLocator =
    /page\.locator\s*\(/u.test(source) ||
    /page\.\$\s*\(/u.test(source) ||
    /xpath\s*=/iu.test(source) ||
    /locator\s*\(\s*['"`](?:#|\.|\[|\/\/)/u.test(source);
  const hasRationale = input.nonSemanticLocatorDiagnostics?.some(
    (diagnostic) =>
      diagnostic.code === ARXIC_COMPILE_LOCATOR_NONSEMANTIC &&
      diagnostic.severity === 'blocked' &&
      diagnostic.message.trim().length > 0,
  );
  if (hasNonSemanticLocator && !hasRationale) {
    diagnostics.push(
      compileDiagnostic(
        ARXIC_COMPILE_LOCATOR_NONSEMANTIC,
        'generated-source',
        'Generated source uses a CSS or XPath locator without a reviewed diagnostic rationale',
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

function sensitiveValues(workflow: Workflow): string[] {
  const values: string[] = [];
  for (const precondition of workflow.preconditions) {
    collectSensitiveValues(precondition.parameters, values);
  }
  return values.filter((value) => value.length >= 3);
}

function collectSensitiveValues(value: unknown, target: string[], key = ''): void {
  if (typeof value === 'string') {
    if (/email|password|secret|token|phone|name/iu.test(key) || value.includes('@'))
      target.push(value);
    return;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const [childKey, childValue] of Object.entries(value)) {
    collectSensitiveValues(childValue, target, childKey);
  }
}
