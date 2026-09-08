import { rm } from 'node:fs/promises';
import { afterEach, expect, it } from 'vitest';
import { collectFrontendInventory, SourceUaAdapter } from '../index';
import { makeRepository } from './test-repo';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0).reverse()) await rm(root, { recursive: true, force: true });
});

/**
 * Conditional-state enrichment (refs #402 route omission coverage): condition
 * rows carry their bounded collapsed source text so downstream consumers can
 * classify loading/error/empty state references per route. The existing
 * kind-based pin in frontend.test.ts is label-agnostic and stays untouched.
 */
it('labels condition rows with their bounded source condition text on the real fixture', async () => {
  const repo = await makeRepository('reference-auth-app');
  roots.push(repo.root);
  const source = await new SourceUaAdapter().collect(repo.request);
  const result = await collectFrontendInventory(repo.root, source);

  const loginConditions = result.rows.filter(
    (row) => row.kind === 'condition' && row.source.path === 'app/login/page.tsx',
  );
  // The real `{error ? <p className="error">{error}</p> : null}` ternary must
  // surface WITH its condition text, not as a bare node-type label.
  expect(
    loginConditions.some(
      (row) =>
        /^ternary expression \(source condition\): /u.test(row.label) &&
        /error \?/u.test(row.label),
    ),
  ).toBe(true);
  // The `{message ? …}` sibling ternary keeps its own distinct text.
  expect(
    loginConditions.some(
      (row) =>
        /^ternary expression \(source condition\): /u.test(row.label) &&
        /message \?/u.test(row.label),
    ),
  ).toBe(true);
  // Every condition label still names its syntax kind first (machine-parseable
  // shape: "<node kind>: <bounded text>") and respects the row label cap.
  for (const row of result.rows.filter((row) => row.kind === 'condition'))
    expect(row.label.length).toBeLessThanOrEqual(200);
  // Deterministic across collections.
  expect(await collectFrontendInventory(repo.root, source)).toEqual(result);
});
