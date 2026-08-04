import { readFileSync } from 'node:fs';
import Ajv2020, { type ErrorObject } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import {
  ARXIC_WORKFLOW_EVIDENCE_ID_INVALID,
  ARXIC_WORKFLOW_INVALID,
  ARXIC_WORKFLOW_NEGATIVE_NO_EXPECTED,
  ARXIC_WORKFLOW_STATUS_UNKNOWN,
  ARXIC_WORKFLOW_TRANSITION_NO_ASSERTIONS,
  ARXIC_WORKFLOW_VERIFICATION_MISSING,
  ARXIC_WORKFLOW_VERIFIED_WITHOUT_RUNTIME_EVIDENCE,
  type Diagnostic,
} from './diagnostics';
import { EVIDENCE_ID_PATTERN } from './evidence-index';

export { EVIDENCE_ID_PATTERN };

export type TruthState = 'hypothesized' | 'observed' | 'verified' | 'contradicted' | 'blocked';

export type WorkflowScope = {
  commit: string;
  environment: string;
  browser: string;
  featureFlags?: string[];
};

export type WorkflowPrecondition = {
  fixture: string;
  parameters?: Record<string, unknown>;
};

export type WorkflowState = {
  id: string;
};

export type WorkflowAction = {
  intent: string;
  inputRefs?: Record<string, string>;
};

export type WorkflowAssertion = {
  intent: string;
};

export type WorkflowTransition = {
  from: string;
  to: string;
  action: WorkflowAction;
  assertions: WorkflowAssertion[];
  evidenceRefs: string[];
  required?: boolean;
};

export type WorkflowNegativeCase = {
  id: string;
  expected: string;
};

export type WorkflowVerification = {
  requiredRuns: number;
  screenshotCheckpoints: string[];
  forbidNetworkErrors: boolean;
  trace?: 'retain' | 'discard';
};

export type Workflow = {
  $schema: 'https://arxic.dev/schemas/workflow/v1.json';
  id: string;
  version: number;
  title: string;
  domain: string;
  persona: string;
  status: TruthState;
  confidence: number;
  scope: WorkflowScope;
  preconditions: WorkflowPrecondition[];
  states: WorkflowState[];
  transitions: WorkflowTransition[];
  negativeCases: WorkflowNegativeCase[];
  verification: WorkflowVerification;
  evidenceRefs: string[];
};

const schemaUrl = new URL('../../../schemas/workflow/workflow.schema.json', import.meta.url);
let workflowSchema: object;

try {
  workflowSchema = JSON.parse(readFileSync(schemaUrl, 'utf8')) as object;
} catch (error) {
  throw new Error(`Failed to load Workflow schema at ${schemaUrl.pathname}`, { cause: error });
}

const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile<Workflow>(workflowSchema);

const diagnosticCode = (error: ErrorObject) => {
  const missingProperty =
    error.keyword === 'required' ? String(error.params.missingProperty) : undefined;
  if (
    (error.instancePath.match(/^\/transitions\/\d+\/assertions$/) &&
      error.keyword === 'minItems') ||
    (error.instancePath.match(/^\/transitions\/\d+$/) && missingProperty === 'assertions')
  ) {
    return ARXIC_WORKFLOW_TRANSITION_NO_ASSERTIONS;
  }
  if (error.instancePath === '/status' && error.keyword === 'enum') {
    return ARXIC_WORKFLOW_STATUS_UNKNOWN;
  }
  if (error.instancePath.match(/^\/negativeCases\/\d+$/) && missingProperty === 'expected') {
    return ARXIC_WORKFLOW_NEGATIVE_NO_EXPECTED;
  }
  if (error.instancePath === '/verification' && error.keyword === 'required') {
    return ARXIC_WORKFLOW_VERIFICATION_MISSING;
  }
  if (
    error.keyword === 'pattern' &&
    (error.instancePath.match(/^\/transitions\/\d+\/evidenceRefs\/\d+$/) ||
      error.instancePath.match(/^\/evidenceRefs\/\d+$/))
  ) {
    return ARXIC_WORKFLOW_EVIDENCE_ID_INVALID;
  }
  return ARXIC_WORKFLOW_INVALID;
};

const toDiagnostic = (error: ErrorObject): Diagnostic => ({
  code: diagnosticCode(error),
  severity: 'blocked',
  subject: 'workflow',
  message: `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`,
});

export const validateWorkflow = (
  input: unknown,
): { ok: true; value: Workflow } | { ok: false; diagnostics: Diagnostic[] } => {
  if (!validate(input)) {
    return {
      ok: false,
      diagnostics: (validate.errors ?? []).map(toDiagnostic),
    };
  }
  const diagnostics = input.transitions
    .filter(
      (transition) =>
        transition.required !== false &&
        !transition.evidenceRefs.some((evidenceRef) => evidenceRef.startsWith('run:')),
    )
    .map((transition): Diagnostic => ({
      code: ARXIC_WORKFLOW_VERIFIED_WITHOUT_RUNTIME_EVIDENCE,
      severity: 'blocked',
      subject: 'workflow.transition',
      message: `Verified workflow transition ${transition.from}→${transition.to} lacks runtime evidence`,
    }));
  if (input.status === 'verified' && diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }
  return { ok: true, value: input };
};
