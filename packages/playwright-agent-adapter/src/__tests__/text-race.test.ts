// #379: the fallback-generator lane must mirror the #366 race-safe text
// assertion emission. The real reference-auth-app /login renders
// <h1>Login</h1> AND <button type="submit">Login</button> — two elements
// sharing the EXACT full text "Login". The old emission resolved every
// element CONTAINING the text (`getByText(<text>)`, no options), which
// strict-mode-violates on such pairs during render races. Worse, a
// role-qualified intent (`text@heading:Login`) fell into the generic
// containment branch and asserted the literal grammar string against the
// body — a guaranteed miss. The fallback lane now emits role-scoped exact
// locators for role-qualified intents (same fail-closed role allowlist as
// the spec generator) and `{ exact: true }` for plain `text:` intents.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Workflow } from '@arxic/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { ARXIC_AGENT_FALLBACK_FAILED } from '../diagnostics';
import { generateSpecFromWorkflow, renderFallbackSpec } from '../fallback-generator';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function textWorkflow(assertion: string): Workflow {
  return {
    $schema: 'https://arxic.dev/schemas/workflow/v1.json',
    id: 'authentication.replay.text-race',
    version: 1,
    title: 'Text assertion race',
    domain: 'authentication',
    persona: 'anonymous',
    status: 'observed',
    confidence: 1,
    scope: {
      commit: '0123456789abcdef0123456789abcdef01234567',
      environment: 'local-test',
      browser: 'chromium',
    },
    preconditions: [],
    states: [{ id: 'login-page' }, { id: 'login-verified' }],
    transitions: [
      {
        from: 'login-page',
        to: 'login-verified',
        action: { intent: 'open Login' },
        assertions: [{ intent: assertion }],
        evidenceRefs: ['run:login'],
      },
    ],
    negativeCases: [],
    verification: {
      requiredRuns: 1,
      screenshotCheckpoints: ['login-verified'],
      forbidNetworkErrors: true,
      trace: 'retain',
    },
    evidenceRefs: ['run:login'],
  };
}

describe('fallback spec text assertion emission (#379)', () => {
  it('emits a role-scoped exact locator for role-qualified text intents', () => {
    const spec = renderFallbackSpec(textWorkflow('text@heading:Login'), 'http://127.0.0.1:1');
    expect(spec).toContain(
      `page.getByRole('heading', { name: ${JSON.stringify('Login')}, exact: true })`,
    );
    // The grammar literal must never leak into the assertion target.
    expect(spec).not.toContain('text@heading');
  });

  it('emits an exact match for plain text intents (no unscoped substring getByText)', () => {
    const spec = renderFallbackSpec(textWorkflow('text:Success'), 'http://127.0.0.1:1');
    const textLocators = [...spec.matchAll(/getByText\(([^)]*)\)/gu)].map((match) => match[1]);
    expect(textLocators).toHaveLength(1);
    expect(textLocators[0]).toContain(JSON.stringify('Success'));
    expect(textLocators[0]).toContain('exact: true');
  });

  it('fails closed on a role outside the #366 allowlist instead of emitting an unresolvable locator', async () => {
    const testDir = await mkdtemp(join(tmpdir(), 'arxic-379-role-'));
    temporaryDirectories.push(testDir);
    const generated = await generateSpecFromWorkflow(textWorkflow('text@banner:Login'), {
      origin: 'http://127.0.0.1:1',
      testDir,
    });
    expect(generated.ok).toBe(false);
    expect(generated.diagnostics.map((item) => item.code)).toContain(ARXIC_AGENT_FALLBACK_FAILED);
  });

  it('fails closed on empty role-qualified or plain text payloads', async () => {
    for (const assertion of ['text@heading:', 'text:', 'text@heading:   ']) {
      const testDir = await mkdtemp(join(tmpdir(), 'arxic-379-empty-'));
      temporaryDirectories.push(testDir);
      const generated = await generateSpecFromWorkflow(textWorkflow(assertion), {
        origin: 'http://127.0.0.1:1',
        testDir,
      });
      expect(generated.ok, assertion).toBe(false);
      expect(generated.diagnostics.map((item) => item.code)).toContain(ARXIC_AGENT_FALLBACK_FAILED);
    }
  });

  it('preserves the generic body-containment lane for non-text intents', () => {
    const spec = renderFallbackSpec(textWorkflow('visible:.dashboard'), 'http://127.0.0.1:1');
    expect(spec).toContain(
      `await expect(page.locator('body')).toContainText(${JSON.stringify('visible:.dashboard')});`,
    );
  });
});
