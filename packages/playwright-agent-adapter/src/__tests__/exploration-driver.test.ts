import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PlaywrightExplorationDriver,
  type LocatorPair,
  type LocatorResolutionFailure,
  type StepObservation,
} from '../exploration-driver';

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, '../../../..');
const appDir = resolve(root, 'test-fixtures/reference-auth-app');
const temporaryDirectories: string[] = [];
let app: ChildProcess | undefined;
let origin = '';

describe('PlaywrightExplorationDriver locator policy', () => {
  it.each([
    {
      name: 'rejects an ambiguous semantic locator',
      html: '<button data-testid="save">Save</button><button>Save</button>',
      locator: {
        semantic: { kind: 'text', text: 'Save', exact: true },
        execution: { kind: 'test-id', id: 'save' },
      },
      reason: 'semantic-ambiguous',
    },
    {
      name: 'rejects an inaccessible semantic locator',
      html: '<input data-testid="email" type="email">',
      locator: {
        semantic: { kind: 'label', text: 'Email', exact: true },
        execution: { kind: 'test-id', id: 'email' },
      },
      reason: 'semantic-inaccessible',
    },
    {
      name: 'rejects an ambiguous execution locator',
      html: '<label>First<input></label><label>Second<input></label>',
      locator: {
        semantic: { kind: 'label', text: 'First', exact: true },
        execution: { kind: 'role', role: 'textbox' },
      },
      reason: 'execution-ambiguous',
    },
    {
      name: 'rejects an inaccessible execution locator',
      html: '<label>Email<input type="email"></label>',
      locator: {
        semantic: { kind: 'label', text: 'Email', exact: true },
        execution: { kind: 'test-id', id: 'missing' },
      },
      reason: 'execution-inaccessible',
    },
    {
      name: 'rejects locators that identify different elements',
      html: '<label>First<input></label><label>Second<input></label>',
      locator: {
        semantic: { kind: 'label', text: 'First', exact: true },
        execution: { kind: 'label', text: 'Second', exact: true },
      },
      reason: 'mismatch',
    },
  ] as const)('$name', async ({ html, locator, reason }) => {
    // Each case navigates a new Chromium instance before resolving its static DOM. A
    // 250 ms locator-readiness window can expire under suite contention before the
    // semantic control attaches, masking the deliberately constructed execution
    // failure below. Keep this bounded while allowing browser readiness to complete.
    const driver = new PlaywrightExplorationDriver({ timeoutMs: 3_000 });
    try {
      const url = `data:text/html,${encodeURIComponent(html)}`;
      const result = await driver.execute(
        [{ intent: 'fill controlled field', kind: 'fill', url, locator, value: 'not-retained' }],
        { allowedOrigin: url },
      );

      expect(result.observations).toEqual([
        expect.objectContaining({
          intent: 'fill controlled field',
          ok: false,
          locatorResolution: {
            resolved: false,
            reason: reason satisfies LocatorResolutionFailure,
            semantic: locator.semantic,
            execution: locator.execution,
          },
        }),
      ]);
      expect(result.observations[0]?.error).toBeUndefined();
    } finally {
      await driver.close();
    }
  });

  it('drives the structurally identified login controls when duplicate labels occur across forms', async () => {
    const driver = new PlaywrightExplorationDriver();
    try {
      const html = `<form action="/forgot">
          <label>Your email address<input type="email" name="recovery-email"></label>
          <button type="submit">Send reset</button>
        </form>
        <form action="/#/home">
          <label>Your email address<input type="email" name="login-email"></label>
          <label>Your email address<input type="text" name="email-hint"></label>
          <label>Your password<input type="password" name="login-password"></label>
          <button type="submit" onclick="event.preventDefault(); document.getElementById('status').textContent = this.form.elements['login-email'].value === 'persona@example.test' && this.form.elements['login-password'].value === 'Secret1!' ? 'Login form only' : 'Wrong form or control'">Log In</button>
        </form><p id="status">Idle</p>`;
      const url = `data:text/html,${encodeURIComponent(html)}`;
      const loginScope = {
        fieldLabel: 'Your email address',
        submitName: 'Log In',
        control: { tag: 'input', type: 'email' },
        submitControl: { tag: 'button', type: 'submit' },
      } as const;
      const result = await driver.execute(
        [
          {
            intent: 'fill login email',
            kind: 'fill',
            url,
            locator: {
              semantic: { kind: 'label', text: 'Your email address', exact: true },
              execution: { kind: 'label', text: 'Your email address', exact: true },
            },
            formScope: loginScope,
            value: 'persona@example.test',
          },
          {
            intent: 'fill login password',
            kind: 'fill',
            locator: {
              semantic: { kind: 'label', text: 'Your password', exact: true },
              execution: { kind: 'label', text: 'Your password', exact: true },
            },
            formScope: {
              ...loginScope,
              control: { tag: 'input', type: 'password' },
            },
            value: 'Secret1!',
          },
          {
            intent: 'submit login',
            kind: 'click',
            locator: {
              semantic: { kind: 'role', role: 'button', name: 'Log In', exact: true },
              execution: { kind: 'role', role: 'button', name: 'Log In', exact: true },
            },
            formScope: {
              ...loginScope,
              control: { tag: 'button', type: 'submit' },
            },
          },
        ],
        { allowedOrigin: url },
      );

      expect(result.observations.map((observation) => observation.ok)).toEqual([true, true, true]);
      expect(result.observations.map((observation) => observation.locatorResolution)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            resolved: true,
            structuralConstraint: { tag: 'input', type: 'email' },
          }),
          expect.objectContaining({
            resolved: true,
            structuralConstraint: { tag: 'input', type: 'password' },
          }),
          expect.objectContaining({
            resolved: true,
            structuralConstraint: { tag: 'button', type: 'submit' },
          }),
        ]),
      );
      expect(JSON.stringify(result.observations[2]?.accessibilitySnapshot)).toContain(
        'Login form only',
      );
    } finally {
      await driver.close();
    }
  });

  it('rejects an injected ARIA role before constructing or acting through a locator', async () => {
    const driver = new PlaywrightExplorationDriver();
    try {
      const url = `data:text/html,${encodeURIComponent(
        '<button onclick="status.textContent=\'Clicked\'">Save</button><button>Save</button><button>Save</button><p id="status">Idle</p>',
      )}`;
      const locator = {
        semantic: { kind: 'role', role: 'button >> nth=0' },
        execution: { kind: 'role', role: 'button', name: 'Save' },
      } as const;
      const result = await driver.execute(
        [{ intent: 'reject injected role', kind: 'click', url, locator }],
        { allowedOrigin: url },
      );

      expect(result.observations[0]).toEqual(
        expect.objectContaining({
          ok: false,
          locatorResolution: { resolved: false, reason: 'semantic-invalid', ...locator },
        }),
      );
      const after = await driver.execute(
        [{ intent: 'observe rejected action', kind: 'snapshot' }],
        {
          allowedOrigin: url,
        },
      );
      expect(JSON.stringify(after.observations[0]?.accessibilitySnapshot)).not.toContain('Clicked');
    } finally {
      await driver.close();
    }
  });

  it('rejects an injected execution role before constructing or acting through a locator', async () => {
    const driver = new PlaywrightExplorationDriver();
    try {
      const url = `data:text/html,${encodeURIComponent(
        '<button onclick="status.textContent=\'Clicked\'">Save</button><p id="status">Idle</p>',
      )}`;
      const locator = {
        semantic: { kind: 'role', role: 'button', name: 'Save' },
        execution: { kind: 'role', role: 'button >> nth=0', name: 'Save' },
      } as const;
      const result = await driver.execute(
        [{ intent: 'reject injected execution role', kind: 'click', url, locator }],
        { allowedOrigin: url },
      );

      expect(result.observations[0]).toEqual(
        expect.objectContaining({
          ok: false,
          locatorResolution: { resolved: false, reason: 'execution-invalid', ...locator },
        }),
      );
      const after = await driver.execute(
        [{ intent: 'observe rejected action', kind: 'snapshot' }],
        {
          allowedOrigin: url,
        },
      );
      expect(JSON.stringify(after.observations[0]?.accessibilitySnapshot)).not.toContain('Clicked');
    } finally {
      await driver.close();
    }
  });

  it('removes multiline fill values and ANSI call-log fragments when an action fails', async () => {
    const driver = new PlaywrightExplorationDriver();
    const secret = 'line1\nSECRET-line2';
    try {
      const url = `data:text/html,${encodeURIComponent(
        '<input type="checkbox"><label>Sentinel<input value="privacy-sentinel"></label>',
      )}`;
      const result = await driver.execute(
        [
          {
            intent: 'fill unsupported control',
            kind: 'fill',
            url,
            locator: {
              semantic: { kind: 'role', role: 'checkbox' },
              execution: { kind: 'role', role: 'checkbox' },
            },
            value: secret,
          },
        ],
        { allowedOrigin: url },
      );

      expect(result.observations[0]).toEqual(
        expect.objectContaining({
          ok: false,
          locatorResolution: expect.objectContaining({ resolved: true }),
          error: expect.any(String),
        }),
      );
      expect(result.observations[0]?.error).not.toContain(secret);
      expect(result.observations[0]?.error).not.toContain('SECRET-line2');
      expect(result.observations[0]?.error).not.toContain('\u001B');
      const afterFailure = await driver.execute(
        [{ intent: 'snapshot after failed fill', kind: 'snapshot' }],
        { allowedOrigin: url },
      );
      expect(JSON.stringify(afterFailure.observations[0]?.accessibilitySnapshot)).toContain(
        'privacy-sentinel',
      );
    } finally {
      await driver.close();
    }
  });

  it('waits for a client-rendered control before applying the exactly-one gate', async () => {
    const driver = new PlaywrightExplorationDriver({ timeoutMs: 1_000 });
    try {
      const html = `<div id="root"></div><script>
        setTimeout(() => root.innerHTML = '<label>Email<input data-testid="email"></label>', 50);
      </script>`;
      const url = `data:text/html,${encodeURIComponent(html)}`;
      const result = await driver.execute(
        [
          {
            intent: 'fill client-rendered control',
            kind: 'fill',
            url,
            locator: {
              semantic: { kind: 'label', text: 'Email', exact: true },
              execution: { kind: 'test-id', id: 'email' },
            },
            value: 'client-rendered-value',
          },
        ],
        { allowedOrigin: url },
      );

      expect(result.observations[0]).toEqual(
        expect.objectContaining({
          ok: true,
          locatorResolution: expect.objectContaining({
            resolved: true,
            sameElementProof: true,
          }),
        }),
      );
    } finally {
      await driver.close();
    }
  });

  it('fails closed when a rerender replaces the identity-checked execution element', async () => {
    const driver = new PlaywrightExplorationDriver({ timeoutMs: 2_000 });
    try {
      const html = `<label>Email<input data-testid="email" onfocus="const replacement = this.cloneNode(); replacement.removeAttribute('onfocus'); replacement.dataset.replacement = 'true'; this.replaceWith(replacement)"></label>`;
      const url = `data:text/html,${encodeURIComponent(html)}`;
      const result = await driver.execute(
        [
          {
            intent: 'fill identity-checked node',
            kind: 'fill',
            url,
            locator: {
              semantic: { kind: 'label', text: 'Email', exact: true },
              execution: { kind: 'test-id', id: 'email' },
            },
            value: 'must-not-land-on-replacement',
          },
        ],
        { allowedOrigin: url },
      );

      expect(result.observations[0]).toEqual(
        expect.objectContaining({
          ok: false,
          locatorResolution: expect.objectContaining({ resolved: true }),
          error: expect.any(String),
        }),
      );
      expect(result.observations[0]?.error).toMatch(/not attached to the DOM/i);
    } finally {
      await driver.close();
    }
  });

  it('carries text-control values in an unredacted accessibility snapshot', async () => {
    const driver = new PlaywrightExplorationDriver();
    const value = 'positive-control-accessibility-value';
    try {
      const url = `data:text/html,${encodeURIComponent(
        `<label>Email<input value="${value}"></label>`,
      )}`;
      const result = await driver.execute(
        [{ intent: 'capture positive control', kind: 'navigate', url }],
        { allowedOrigin: url },
      );

      expect(JSON.stringify(result.observations[0]?.accessibilitySnapshot)).toContain(value);
    } finally {
      await driver.close();
    }
  });

  it('removes a filled text-control value from the accessibility snapshot', async () => {
    const driver = new PlaywrightExplorationDriver();
    const value = 'line1\nSECRET-line2';
    try {
      const url = `data:text/html,${encodeURIComponent('<label>Message<textarea></textarea></label>')}`;
      const result = await driver.execute(
        [
          {
            intent: 'fill negative control',
            kind: 'fill',
            url,
            locator: {
              semantic: { kind: 'label', text: 'Message', exact: true },
              execution: { kind: 'label', text: 'Message', exact: true },
            },
            value,
          },
        ],
        { allowedOrigin: url },
      );

      expect(result.observations[0]?.ok).toBe(true);
      expect(JSON.stringify(result.observations[0]?.accessibilitySnapshot)).not.toContain(value);
      expect(JSON.stringify(result.observations[0]?.accessibilitySnapshot)).not.toContain(
        'SECRET-line2',
      );
    } finally {
      await driver.close();
    }
  });

  it('removes a filled value mirrored into another element across the accessibility snapshot', async () => {
    const driver = new PlaywrightExplorationDriver();
    const value = 'mirrored-filled-value';
    try {
      const html = `<label>Message<input oninput="echo.textContent=this.value"></label><p id="echo"></p>`;
      const url = `data:text/html,${encodeURIComponent(html)}`;
      const result = await driver.execute(
        [
          {
            intent: 'fill mirrored value',
            kind: 'fill',
            url,
            locator: {
              semantic: { kind: 'label', text: 'Message', exact: true },
              execution: { kind: 'label', text: 'Message', exact: true },
            },
            value,
          },
        ],
        { allowedOrigin: url },
      );

      expect(result.observations[0]?.ok).toBe(true);
      expect(JSON.stringify(result.observations[0]?.accessibilitySnapshot)).not.toContain(value);
    } finally {
      await driver.close();
    }
  });

  it('removes a filled numeric credential from a numeric control value in the accessibility snapshot', async () => {
    // A numeric AX `value` (Chrome reports <input type="number"> as a spinbutton with a
    // numeric value) must be scrubbed too — TOTP/PIN/OTP codes are numeric credentials.
    const driver = new PlaywrightExplorationDriver();
    const value = '123456';
    try {
      const url = `data:text/html,${encodeURIComponent('<label>PIN<input type="number"></label>')}`;
      const result = await driver.execute(
        [
          {
            intent: 'fill numeric credential',
            kind: 'fill',
            url,
            locator: {
              semantic: { kind: 'label', text: 'PIN', exact: true },
              execution: { kind: 'label', text: 'PIN', exact: true },
            },
            value,
          },
        ],
        { allowedOrigin: url },
      );

      expect(result.observations[0]?.ok).toBe(true);
      expect(JSON.stringify(result.observations[0]?.accessibilitySnapshot)).not.toContain(value);
    } finally {
      await driver.close();
    }
  });

  describe('real reference-auth-app proof', () => {
    beforeAll(async () => {
      await execute('pnpm', ['--filter', 'reference-auth-app', 'build'], {
        cwd: root,
        timeout: 180_000,
      });
      const runtime = await temporaryDirectory('locator-policy-runtime-');
      const port = await freePort();
      origin = `http://127.0.0.1:${port}`;
      app = spawn(
        process.execPath,
        [resolve(appDir, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port)],
        {
          cwd: appDir,
          env: {
            ...process.env,
            ARXIC_TARGET_ORIGIN: origin,
            ARXIC_ATTESTATION_NONCE: 'locator-policy-real-world-proof',
            ARXIC_DB_PATH: join(runtime, 'auth.db'),
          },
          stdio: 'ignore',
          shell: false,
        },
      );
      await readiness(origin, app);
      expect((await fetch(`${origin}/__arxic/reset`, { method: 'POST' })).status).toBe(204);
      expect(
        (
          await fetch(`${origin}/__arxic/seed`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              personaId: 'locator-policy-user',
              email: 'locator-policy@example.test',
              password: 'LocatorPolicy1!',
            }),
          })
        ).status,
      ).toBe(201);
    }, 240_000);

    afterAll(async () => {
      await stop(app);
      await Promise.all(
        temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
      );
    });

    it('rejects the requested Login text locator because the real page also has a Login heading', async () => {
      const driver = new PlaywrightExplorationDriver();
      try {
        const result = await driver.execute(
          [
            {
              intent: 'click login by text and role',
              kind: 'click',
              url: `${origin}/login`,
              locator: {
                semantic: { kind: 'text', text: 'Login', exact: true },
                execution: { kind: 'role', role: 'button', name: 'Login', exact: true },
              },
            },
          ],
          { allowedOrigin: origin },
        );

        expect(result.observations[0]).toEqual(
          expect.objectContaining({
            ok: false,
            locatorResolution: expect.objectContaining({
              resolved: false,
              reason: 'semantic-ambiguous',
            }),
          }),
        );
      } finally {
        await driver.close();
      }
    });

    it('fills both credentials and reaches the signed-in page through identity-checked controls', async () => {
      const email: LocatorPair = {
        semantic: { kind: 'label', text: 'Email', exact: true },
        execution: { kind: 'role', role: 'textbox', name: 'Email', exact: true },
      };
      const submit: LocatorPair = {
        semantic: { kind: 'role', role: 'button', name: 'Login', exact: true },
        execution: { kind: 'role', role: 'button', name: 'Login', exact: true },
      };
      const password: LocatorPair = {
        semantic: { kind: 'label', text: 'Password', exact: true },
        execution: { kind: 'label', text: 'Password', exact: true },
      };
      const evidenceDir = await temporaryDirectory('locator-policy-evidence-');
      const driver = new PlaywrightExplorationDriver({ evidenceDir });
      try {
        const result = await driver.execute(
          [
            {
              intent: 'fill email',
              kind: 'fill',
              url: `${origin}/login`,
              locator: email,
              value: 'locator-policy@example.test',
            },
            {
              intent: 'fill password',
              kind: 'fill',
              locator: password,
              value: 'LocatorPolicy1!',
            },
            { intent: 'click login', kind: 'click', locator: submit },
          ],
          { allowedOrigin: origin },
        );

        expect(result.observations).toHaveLength(3);
        for (const observation of result.observations) {
          expect(observation).toEqual(
            expect.objectContaining({
              ok: true,
              locatorResolution: expect.objectContaining({ resolved: true }),
              accessibilitySnapshot: expect.objectContaining({ role: 'RootWebArea' }),
              accessibilitySnapshotSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            }),
          );
          expect(JSON.stringify(observation.accessibilitySnapshot)).not.toContain(
            'locator-policy@example.test',
          );
          expect(JSON.stringify(observation.accessibilitySnapshot)).not.toContain(
            'LocatorPolicy1!',
          );
          expect(observation.screenshotRef).toBeUndefined();
        }
        const signedIn = await waitForObservation(
          driver,
          origin,
          (observation) =>
            observation.url === `${origin}/` &&
            JSON.stringify(observation.accessibilitySnapshot).includes('Logout'),
        );
        expect(signedIn.url).toBe(`${origin}/`);
        expect(JSON.stringify(signedIn.accessibilitySnapshot)).toContain('Logout');
        expect(JSON.stringify(signedIn.accessibilitySnapshot)).not.toContain(
          'locator-policy@example.test',
        );
        expect(JSON.stringify(signedIn.accessibilitySnapshot)).not.toContain('LocatorPolicy1!');
        expect(signedIn.screenshotRef).toBeUndefined();
        process.stdout.write(
          `Locator policy proof: Chromium ${result.browserVersion}; signed-in ${signedIn.url}; a11y ${signedIn.accessibilitySnapshotSha256?.slice(0, 12)}\n`,
        );
      } finally {
        await driver.close();
      }
    }, 120_000);
  });
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate port');
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return address.port;
}

async function readiness(url: string, child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Reference app exited with ${child.exitCode}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
  }
  throw new Error('Reference app readiness timed out');
}

async function stop(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolveExit) => child.once('exit', () => resolveExit())),
    new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 5_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `arxic-adapter-${prefix}`));
  temporaryDirectories.push(directory);
  return directory;
}

async function waitForObservation(
  driver: PlaywrightExplorationDriver,
  allowedOrigin: string,
  predicate: (observation: StepObservation) => boolean,
): Promise<StepObservation> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await driver.execute(
      [{ intent: 'observe signed-in transition', kind: 'snapshot' }],
      {
        allowedOrigin,
      },
    );
    const observation = result.observations[0];
    if (observation && predicate(observation)) return observation;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw new Error('Signed-in transition was not observed');
}
