import { expect, it } from 'vitest';
import {
  captureForStep,
  checkpointOf,
  runLevelActions,
  stepsForCaptures,
  type ActionStep,
} from '../action-log';
import type { Capture, VisualEnvironment } from '../types';

const chrome: VisualEnvironment = { browser: 'chromium', colorScheme: 'light' };
const safari: VisualEnvironment = { browser: 'webkit', colorScheme: 'light' };

const capture = (id: string, environment = chrome): Capture =>
  ({
    id,
    environment,
    path: '/login',
    viewport: { width: 1280, height: 800 },
    file: `${id}.png`,
    sha256: 'a'.repeat(64),
    specHash: 'b'.repeat(64),
    browserVersion: '151',
    status: 'unchanged',
  }) as Capture;

const step = (action: string, checkpoint: number, environment = chrome): ActionStep => ({
  action,
  checkpoint,
  environment,
});

it('reads the checkpoint a capture was taken at from its own id', () => {
  expect(checkpointOf({ id: 'checkpoint-1' })).toBe(0);
  expect(checkpointOf({ id: 'chromium-dark-2x-checkpoint-7' })).toBe(6);
  expect(checkpointOf({ id: 'not-a-checkpoint' })).toBeUndefined();
});

it('keeps only the steps that produced this page, plus how the run got there', () => {
  const steps = [
    step('crawl-same-origin-links', 0),
    step('sign-in-form', 0),
    step('navigate', 0),
    step('capture-input-masked-viewport', 0),
    step('navigate', 1),
    step('capture-input-masked-viewport', 1),
  ];
  const kept = stepsForCaptures(steps, [capture('checkpoint-2')]);
  // Signing in is part of how a page behind a login was reached, so it stays.
  expect(kept.map((entry) => entry.action)).toEqual([
    'crawl-same-origin-links',
    'sign-in-form',
    'navigate',
    'capture-input-masked-viewport',
  ]);
  expect(
    kept.filter((entry) => !runLevelActions.has(entry.action)).every((e) => e.checkpoint === 1),
  ).toBe(true);
});

it('never attributes another page’s work to this one', () => {
  // Checkpoint numbering starts at 0 and the run-level steps carry 0 too, so a
  // join on the number alone would hand the first page every setup step and
  // hand every page the first page's work.
  const steps = [step('sign-in-form', 0), step('navigate', 0), step('navigate', 1)];
  const kept = stepsForCaptures(steps, [capture('checkpoint-2')]);
  expect(kept.filter((entry) => entry.action === 'navigate')).toHaveLength(1);
  expect(kept.find((entry) => entry.action === 'navigate')!.checkpoint).toBe(1);
});

it('keeps each browser’s steps with its own screenshots', () => {
  const steps = [
    step('navigate', 0, chrome),
    step('capture-input-masked-viewport', 0, chrome),
    step('navigate', 0, safari),
    step('capture-input-masked-viewport', 0, safari),
  ];
  const kept = stepsForCaptures(steps, [capture('chromium-light-checkpoint-1', chrome)]);
  expect(kept).toHaveLength(2);
  expect(kept.every((entry) => entry.environment?.browser === 'chromium')).toBe(true);
});

it('says nothing rather than guessing when the log does not line up', () => {
  // A log whose checkpoints belong to a different run shape must not be shown
  // wholesale under one page's heading.
  expect(stepsForCaptures([step('navigate', 5)], [capture('checkpoint-1')])).toEqual([]);
  expect(stepsForCaptures([step('navigate', 0)], [capture('no-checkpoint-here')])).toEqual([]);
  expect(stepsForCaptures([], [capture('checkpoint-1')])).toEqual([]);
});

it('names the screenshot each step produced, so two screen sizes do not read alike', () => {
  const desktop = capture('checkpoint-1');
  const phone = { ...capture('checkpoint-2'), viewport: { width: 390, height: 844 } } as Capture;
  const steps = [step('navigate', 0), step('navigate', 1), step('sign-in-form', 0)];
  expect(captureForStep(steps[0]!, [desktop, phone])).toBe(desktop);
  expect(captureForStep(steps[1]!, [desktop, phone])).toBe(phone);
  // A run-level step produced no screenshot of its own.
  expect(captureForStep(steps[2]!, [desktop, phone])).toBeUndefined();
});
