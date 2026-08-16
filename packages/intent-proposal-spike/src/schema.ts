import type { Diagnostic } from '@arxic/contracts';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { ARXIC_PROPOSAL_RUN_BLOCKED, proposalDiagnostic } from './diagnostics';

/**
 * Schema vNext for model-driven intent proposals (DG-04 / #248).
 *
 * Design contract (binding, from issue #248 + ADR-008 Decisions 3/4/6):
 * - arbitrary-domain: `domain` is any slug; pipeline code carries no domain literal;
 * - every proposal MUST cite >=1 inventory row id and >=1 source EvidenceRef id;
 * - there is NO truth-state field: model output is data and can never assert
 *   `verified` (or any state) — binding assigns `hypothesized` deterministically;
 * - bounded free text with no control characters (prompt-injection surface);
 * - `schemaVersion` literal is enforced by the ModelAdapter (version drift fails
 *   closed) exactly as in stage-4 today (`packages/model-adapter/src/adapter.ts`
 *   assertSchemaVersion).
 */
export const INTENT_PROPOSAL_SCHEMA_VERSION = 'arxic-intent-proposal-v1' as const;

/** Inventory row ids minted by the stand-in exporter (see inventory.ts). */
export const INVENTORY_ROW_ID_PATTERN =
  /^inv:(?:route|page):[A-Z]+:[A-Za-z0-9._#/$~{}-]+:[0-9a-f]{8}:[0-9]+$/u;

/** Evidence ids use the frozen contracts grammar (src|run|doc; ADR-002). */
export const EVIDENCE_REF_ID_PATTERN = /^(?:src|run|doc):[A-Za-z0-9._#-]+(?::[A-Za-z0-9._#-]+)?$/u;

const CITE_ITEM = {
  type: 'string',
  minLength: 1,
  maxLength: 256,
} as const;

const PROPOSAL_ITEM = {
  type: 'object',
  required: [
    'domain',
    'intent',
    'action',
    'fromState',
    'toState',
    'persona',
    'inventoryRowIds',
    'evidenceRefIds',
    'rationale',
  ],
  additionalProperties: false,
  properties: {
    domain: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[a-z0-9][a-z0-9.-]*$' },
    intent: { type: 'string', minLength: 1, maxLength: 200, pattern: '^[^\\u0000-\\u001f]+$' },
    action: { type: 'string', minLength: 1, maxLength: 200, pattern: '^[^\\u0000-\\u001f]+$' },
    fromState: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[^\\u0000-\\u001f]+$' },
    toState: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[^\\u0000-\\u001f]+$' },
    persona: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[^\\u0000-\\u001f]+$' },
    inventoryRowIds: {
      type: 'array',
      minItems: 1,
      maxItems: 64,
      uniqueItems: true,
      items: CITE_ITEM,
    },
    evidenceRefIds: {
      type: 'array',
      minItems: 1,
      maxItems: 64,
      uniqueItems: true,
      items: CITE_ITEM,
    },
    rationale: { type: 'string', maxLength: 500, pattern: '^[^\\u0000-\\u001f]*$' },
  },
} as const;

export const INTENT_PROPOSAL_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['schemaVersion', 'proposals'],
  additionalProperties: false,
  properties: {
    // enum (not const): widest structured-output wire compatibility across
    // OpenAI-compatible providers; the literal is still enforced exactly.
    schemaVersion: { type: 'string', enum: [INTENT_PROPOSAL_SCHEMA_VERSION] },
    proposals: {
      type: 'array',
      maxItems: 512,
      items: PROPOSAL_ITEM,
    },
  },
} as const;

/**
 * WIRE PROJECTION of the schema. OpenAI strict structured outputs rejects
 * `uniqueItems` (empirically: provider 400 "In context=('properties',
 * 'proposals','items','properties','inventoryRowIds'), 'uniqueItems' is not
 * permitted", OpenRouter -> OpenAI, 2026-08-16). Uniqueness of citation arrays
 * is therefore re-enforced deterministically AFTER the call by the binding
 * layer (validateProposalOutput keeps uniqueItems; dedupe collapses repeats),
 * so the wire cannot weaken the invariant — it only stops the provider from
 * rejecting the request.
 */
function stripUnsupportedForWire(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripUnsupportedForWire);
  if (typeof node !== 'object' || node === null) return node;
  return Object.fromEntries(
    Object.entries(node as Record<string, unknown>)
      .filter(([key]) => key !== 'uniqueItems')
      .map(([key, value]) => [key, stripUnsupportedForWire(value)]),
  );
}

export const INTENT_PROPOSAL_WIRE_SCHEMA = stripUnsupportedForWire(
  INTENT_PROPOSAL_OUTPUT_SCHEMA,
) as object;

/** The wire shape of a single model proposal (pre-binding). */
export type IntentProposalVNext = {
  readonly domain: string;
  readonly intent: string;
  readonly action: string;
  readonly fromState: string;
  readonly toState: string;
  readonly persona: string;
  readonly inventoryRowIds: readonly string[];
  readonly evidenceRefIds: readonly string[];
  readonly rationale: string;
};

export type IntentProposalOutput = {
  readonly schemaVersion: typeof INTENT_PROPOSAL_SCHEMA_VERSION;
  readonly proposals: readonly IntentProposalVNext[];
};

let compiled: ValidateFunction<unknown> | undefined;

function compile(): ValidateFunction<unknown> {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  return ajv.compile(INTENT_PROPOSAL_OUTPUT_SCHEMA);
}

export type ProposalValidationResult =
  { ok: true; value: IntentProposalOutput } | { ok: false; diagnostics: readonly Diagnostic[] };

export function validateProposalOutput(value: unknown): ProposalValidationResult {
  compiled ??= compile();
  if (compiled(value)) {
    return { ok: true, value: value as IntentProposalOutput };
  }
  const message = (compiled.errors ?? [])
    .map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
    .join('; ');
  return {
    ok: false,
    diagnostics: [
      proposalDiagnostic(
        ARXIC_PROPOSAL_RUN_BLOCKED,
        'blocked',
        'intent-proposal-output',
        message || 'Intent proposal output is invalid',
      ),
    ],
  };
}
