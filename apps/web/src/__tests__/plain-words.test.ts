import { expect, it } from 'vitest';
import {
  browserName,
  captureWords,
  checkKinds,
  checkWords,
  environmentWords,
  evidenceWords,
  projectEnvironments,
  runModeWords,
  runNeedsConfirmation,
  sizeName,
  stateName,
  themeName,
} from '../plain-words';

/** Engine nouns and identifier shapes a person should never have to read. */
const jargon =
  /_|::|[a-z]+-[a-z]+-[a-z]+|\b(?:baseline|hypothesized|contradicted|disposition|surface|intent|inventory|viewport|axe|wcag|dom|ssim|param|payload)\b/iu;

/** A label must never simply echo the engine's own identifier back at the reader. */
const echoesTerm = (words: { label: string; term: string }) =>
  words.label.toLowerCase().replace(/[^a-z]+/gu, '-') === words.term;

it('says what a comparison means without using the engine’s word for it', () => {
  for (const status of ['unchanged', 'changed', 'needs-baseline', 'unstable']) {
    const words = captureWords(status);
    expect(words.label).not.toMatch(jargon);
    expect(echoesTerm(words)).toBe(false);
    expect(words.detail.length).toBeGreaterThan(20);
    expect(words.term).toBe(status);
  }
  expect(captureWords('unchanged').label).toBe('Looks the same');
  expect(captureWords('changed').label).toBe('Looks different');
  expect(captureWords('needs-baseline').label).toBe('First look');
});

it('counts the pixels in the detail, not the label', () => {
  const words = captureWords('changed', 4231);
  expect(words.label).toBe('Looks different');
  expect(words.detail).toContain('4,231');
});

it('keeps the engine word available rather than hiding it', () => {
  expect(captureWords('needs-baseline').term).toBe('needs-baseline');
  expect(evidenceWords('hypothesized').term).toBe('hypothesized');
  expect(checkWords('unlabeled-inputs', 2).term).toBe('unlabeled-inputs');
});

it('never lets a run claim a person’s verdict', () => {
  expect(evidenceWords('verified').label).toBe('Confirmed by a person');
  expect(evidenceWords('verified').detail).toContain('never set this');
});

it('describes each kind of run by what it does for you', () => {
  expect(runModeWords('discovery').label).toBe('Read the code');
  expect(runModeWords('visual').label).toBe('Screenshot test');
  expect(runModeWords('agent').label).toBe('AI walkthrough');
  for (const mode of ['discovery', 'visual', 'agent', 'review'])
    expect(runModeWords(mode).label).not.toMatch(jargon);
});

it('phrases a check as the thing that should be true, and its failure as what went wrong', () => {
  expect(checkWords('unlabeled-inputs', 0, true).label).toBe('Every field has a label');
  expect(checkWords('unlabeled-inputs', 3).label).toBe('3 fields have no label');
  expect(checkWords('unlabeled-inputs', 1).label).toBe('1 field has no label');
  expect(checkWords('unlabeled-inputs', 1).detail).toContain('edit text');
});

it('gives every check a readable label in both states', () => {
  for (const kind of checkKinds) {
    for (const words of [checkWords(kind, 0, true), checkWords(kind, 2)]) {
      expect(words.label).not.toMatch(jargon);
      expect(echoesTerm(words)).toBe(false);
    }
    expect(checkWords(kind, 2).detail.length).toBeGreaterThan(20);
  }
  expect(checkKinds.length).toBeGreaterThan(15);
});

it('does not paint the engine working as designed as a defect', () => {
  // Outside requests are blocked on purpose; red here would make every healthy
  // page look broken.
  expect(checkWords('blocked-network-requests', 3).tone).toBe('neutral');
  expect(checkWords('capture-budget-truncated-pages', 3).tone).toBe('attention');
  expect(checkWords('broken-images', 1).tone).toBe('problem');
});

it('falls back readably for a check kind it has never seen', () => {
  const words = checkWords('some-new-detector', 1);
  expect(words.label).toBe('Some new detector');
  expect(words.term).toBe('some-new-detector');
});

it('names browsers, themes and screen sizes the way people do', () => {
  expect(browserName('chromium')).toBe('Chrome');
  expect(browserName('webkit')).toBe('Safari');
  expect(themeName('dark')).toBe('Dark');
  expect(sizeName(390)).toBe('Phone');
  expect(sizeName(768)).toBe('Tablet');
  expect(sizeName(1440)).toBe('Desktop');
});

it('says what a state checkpoint is showing', () => {
  expect(stateName(undefined)).toBe('Normal');
  expect(stateName('error')).toBe('When something fails');
  expect(stateName('empty')).toBe('With no data');
  expect(stateName('half-loaded')).toBe('Half loaded');
});

it('asks before a run that acts on production, and only then', () => {
  const production = { environment: 'production' };
  const staging = { environment: 'staging' };
  // Looking is not acting: a screenshot test opens pages and photographs them.
  expect(runNeedsConfirmation(production, 'visual')).toBe(false);
  expect(runNeedsConfirmation(production, 'discovery')).toBe(false);
  // An AI walkthrough clicks, types and submits.
  expect(runNeedsConfirmation(production, 'agent')).toBe(true);
  // So does a checkpoint configured to submit forms.
  expect(
    runNeedsConfirmation({ ...production, stateCaptures: [{ submitEmptyForms: true }] }, 'visual'),
  ).toBe(true);
  expect(runNeedsConfirmation({ ...production, stateCaptures: [{}] }, 'visual')).toBe(false);
  // Anywhere else, never: a question asked on every run is a question nobody reads.
  expect(runNeedsConfirmation(staging, 'agent')).toBe(false);
  expect(runNeedsConfirmation({}, 'agent')).toBe(false);
});

it('names the three copies of a site, and treats an unlabelled one as development', () => {
  expect(projectEnvironments.map((option) => option.term)).toEqual([
    'development',
    'staging',
    'production',
  ]);
  expect(environmentWords(undefined).term).toBe('development');
  expect(environmentWords('nonsense').term).toBe('development');
  expect(environmentWords('production').risky).toBe(true);
  expect(environmentWords('staging').risky).toBe(false);
  for (const option of projectEnvironments) {
    expect(option.label).not.toMatch(jargon);
    expect(option.detail.length).toBeGreaterThan(20);
  }
});
