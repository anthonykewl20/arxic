import type { Capture, VisualEnvironment } from './types';

/**
 * The sanitized record of what a run did, and how to read it.
 *
 * A recording of the session would be the obvious way to show how a page
 * behaves, and the product refuses to make one: video frames cannot carry the
 * privacy masks a screenshot gets, so an unmasked recording would leak
 * whatever was on screen. This log is what can be shown honestly instead — the
 * same steps, in the same order, with no field values in them.
 *
 * Pure, so the join below can be tested without a browser.
 */
export type ActionStep = {
  action: string;
  /** Per-environment sequence number of the page capture this step belongs to. */
  checkpoint: number | string;
  result?: string;
  /** Added when the per-environment logs are merged into the run's. */
  environment?: VisualEnvironment;
};

/**
 * Steps that belong to the run rather than to any one page.
 *
 * Checkpoint numbering starts at 0 and these carry 0 too, so the number alone
 * cannot tell "the first page" from "before any page". The action name can,
 * and it is the engine's own fixed vocabulary.
 */
export const runLevelActions = new Set([
  'crawl-same-origin-links',
  'sign-in-form',
  'environment-refused',
]);

const sameEnvironment = (a: VisualEnvironment | undefined, b: VisualEnvironment | undefined) =>
  !a || !b
    ? a === b
    : a.browser === b.browser &&
      a.colorScheme === b.colorScheme &&
      (a.deviceScaleFactor ?? 1) === (b.deviceScaleFactor ?? 1);

/** A capture's id ends in the checkpoint it was taken at, one-based. */
export function checkpointOf(capture: Pick<Capture, 'id'>): number | undefined {
  const match = /checkpoint-(\d+)$/u.exec(capture.id);
  return match ? Number(match[1]) - 1 : undefined;
}

/**
 * The steps that produced these captures, plus the run-level steps that
 * preceded them — signing in is part of how a page behind a login was reached.
 *
 * Returns nothing rather than guessing: a log whose checkpoints do not line up
 * with these captures belongs to a different run shape, and showing all of it
 * under one page's heading would attribute other pages' work to this one.
 */
export function stepsForCaptures(steps: ActionStep[], captures: Capture[]): ActionStep[] {
  const wanted = new Set<string>();
  for (const capture of captures) {
    const checkpoint = checkpointOf(capture);
    if (checkpoint === undefined) continue;
    wanted.add(`${capture.environment?.browser ?? ''}|${checkpoint}`);
  }
  if (!wanted.size) return [];
  const matched = steps.filter(
    (step) =>
      !runLevelActions.has(step.action) &&
      wanted.has(`${step.environment?.browser ?? ''}|${Number(step.checkpoint)}`),
  );
  if (!matched.length) return [];
  const environments = captures.map((capture) => capture.environment);
  const setup = steps.filter(
    (step) =>
      runLevelActions.has(step.action) &&
      environments.some((environment) => sameEnvironment(environment, step.environment)),
  );
  return [...setup, ...matched];
}

/**
 * The screenshot a step produced, when the step belongs to one.
 *
 * A run photographs the same path once per screen size, so its log holds two
 * identical-looking "opened the page" lines. Naming the size each belongs to
 * is the difference between a duplicate and a record.
 */
export function captureForStep(step: ActionStep, captures: Capture[]): Capture | undefined {
  if (runLevelActions.has(step.action)) return undefined;
  return captures.find(
    (capture) =>
      checkpointOf(capture) === Number(step.checkpoint) &&
      sameEnvironment(capture.environment, step.environment),
  );
}
