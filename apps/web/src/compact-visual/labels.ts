import Ajv from 'ajv';

/**
 * VisualLabelV1 — the label provenance contract (spec §9/§14, refs #423).
 * Labels carry the four-state vocabulary (`present`/`absent`/`unknown`/
 * `not_applicable`), a separated origin, and an adjudication state. Safety
 * property: only `adjudicated` records may map onto trainer labels — a
 * `teacher_proposal` or any pending proposal can never silently become
 * training data. Human-review origins must name their reviewer.
 */
export const LABEL_STATES = ['present', 'absent', 'unknown', 'not_applicable'] as const;
export const LABEL_ORIGINS = [
  'human_review',
  'deterministic_predicate',
  'teacher_proposal',
  'controlled_regression',
] as const;
export type LabelState = (typeof LABEL_STATES)[number];
export type LabelOrigin = (typeof LABEL_ORIGINS)[number];
export type VisualLabel = {
  schemaVersion: 'arxic-visual-label-v1';
  caseId: string;
  regionId: string;
  evidenceSha256: string;
  splitGroup: string;
  labels: LabelState[];
  labelOrigin: LabelOrigin;
  adjudication: 'adjudicated' | 'pending';
  criterion: string;
  reviewer: string | null;
};

const object = (properties: Record<string, object>, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const identifier = { type: 'string', pattern: '^[a-zA-Z0-9_.-]{1,120}$' };
const validate = new Ajv({ strict: true }).compile(
  object({
    schemaVersion: { type: 'string', const: 'arxic-visual-label-v1' },
    caseId: identifier,
    regionId: identifier,
    evidenceSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    splitGroup: identifier,
    labels: {
      type: 'array',
      minItems: 6,
      maxItems: 6,
      items: { type: 'string', enum: [...LABEL_STATES] },
    },
    labelOrigin: { type: 'string', enum: [...LABEL_ORIGINS] },
    adjudication: { type: 'string', enum: ['adjudicated', 'pending'] },
    criterion: identifier,
    reviewer: { anyOf: [{ type: 'string', minLength: 1, maxLength: 120 }, { type: 'null' }] },
  }),
);

export function validateVisualLabel(input: unknown): VisualLabel {
  if (!validate(input)) throw new Error('invalid-label');
  const label = input as VisualLabel;
  // Cross-field rules the schema cannot express: every human review names a
  // reviewer, and teacher output is by definition a proposal — never
  // adjudicated truth.
  if (label.labelOrigin === 'human_review' && !label.reviewer) throw new Error('invalid-label');
  if (label.labelOrigin === 'teacher_proposal' && label.adjudication !== 'pending')
    throw new Error('invalid-label');
  return label;
}

/** Map adjudicated four-state labels onto the trainer's 0/1/null encoding. */
export function toTrainingLabels(label: VisualLabel): (0 | 1 | null)[] {
  if (label.adjudication !== 'adjudicated') throw new Error('label-not-adjudicated');
  return label.labels.map((state) => (state === 'present' ? 1 : state === 'absent' ? 0 : null));
}
