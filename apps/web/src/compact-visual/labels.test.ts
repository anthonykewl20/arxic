import { expect, it } from 'vitest';
import { toTrainingLabels, validateVisualLabel, type VisualLabel } from './labels';

const base = (): VisualLabel => ({
  schemaVersion: 'arxic-visual-label-v1',
  caseId: 'koel-360-clip-full',
  regionId: 'viewport',
  evidenceSha256: 'a'.repeat(64),
  splitGroup: 'koel',
  labels: [
    'present',
    'not_applicable',
    'not_applicable',
    'absent',
    'not_applicable',
    'not_applicable',
  ],
  labelOrigin: 'deterministic_predicate',
  adjudication: 'adjudicated',
  criterion: 'required-submit-inside-viewport',
  reviewer: null,
});

it('accepts a well-formed label record and rejects every malformed variant', () => {
  expect(validateVisualLabel(base())).toEqual(base());
  const broken: [string, unknown][] = [
    ['unknown field', { ...base(), extra: 1 }],
    ['five labels', { ...base(), labels: base().labels.slice(1) }],
    [
      'bad state',
      { ...base(), labels: ['maybe', 'absent', 'absent', 'absent', 'absent', 'absent'] },
    ],
    ['bad origin', { ...base(), labelOrigin: 'god' }],
    ['bad adjudication', { ...base(), adjudication: 'maybe' }],
    ['bad hash', { ...base(), evidenceSha256: 'xyz' }],
    [
      'reviewer required for human review',
      { ...base(), labelOrigin: 'human_review', reviewer: null },
    ],
    ['teacher proposals are never adjudicated', { ...base(), labelOrigin: 'teacher_proposal' }],
  ];
  for (const [name, value] of broken) {
    expect(() => validateVisualLabel(value), name).toThrow('invalid-label');
  }
});

it('maps the four label states onto the trainer encoding and refuses pending records', () => {
  const record = base();
  expect(toTrainingLabels(record)).toEqual([1, null, null, 0, null, null]);
  record.labels = ['unknown', 'absent', 'absent', 'unknown', 'not_applicable', 'present'];
  expect(toTrainingLabels(record)).toEqual([null, 0, 0, null, null, 1]);
  const pending = { ...base(), adjudication: 'pending' as const };
  expect(() => toTrainingLabels(pending)).toThrow('label-not-adjudicated');
});
