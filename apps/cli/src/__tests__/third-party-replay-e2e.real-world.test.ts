import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MailpitContainer, type StartedMailpit } from '@arxic/environment';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCli } from '../index';
import {
  bootThirdPartyTarget,
  committedFixtureCopy,
  startStubModelEndpoint,
  type ThirdPartyTarget,
} from './third-party-target';

const root = import.meta.dirname
  ? await import('node:path').then((path) => path.resolve(import.meta.dirname, '../../../..'))
  : process.cwd();

/**
 * #288 G-4 — E2E gate: the full `arxic run` CLI journey against the REAL
 * endpoint-less third-party-shaped target (reference-auth-app behind the
 * G-0 loopback proxy), per-pass login declared. Proves: verified outcome with
 * 2 run records, per-pass login exercised twice, byte-honest stateless
 * re-run, credential hygiene, and the undeclared refusal (G-0 regression
 * half) one stage earlier with the frozen code.
 */
describe('third-party replay E2E (#288 G-4)', () => {
  let target: ThirdPartyTarget | undefined;
  let model: Awaited<ReturnType<typeof startStubModelEndpoint>> | undefined;
  let mailpit: StartedMailpit | undefined;
  let sourceDirectory = '';
  let commit = '';
  let stateDirectory = '';
  const previousEnvironment: Record<string, string | undefined> = {};

  beforeAll(async () => {
    mailpit = await new MailpitContainer().start();
    target = await bootThirdPartyTarget({
      nonce: 'arxic-288-g4',
      mailpitSmtp: mailpit.smtp,
      widgetRequest: true,
    });
    model = await startStubModelEndpoint();
    const staged = await committedFixtureCopy('arxic-288-g4');
    sourceDirectory = staged.directory;
    commit = staged.commit;
    stateDirectory = await mkdtemp(join(tmpdir(), 'arxic-288-g4-state-'));
    for (const name of [
      'ARXIC_MODEL_BASE_URL',
      'ARXIC_MODEL_API_KEY',
      'ARXIC_STATE_DIR',
      'ARXIC_MAILPIT_SMTP',
      'ARXIC_MAILPIT_API',
    ]) {
      previousEnvironment[name] = process.env[name];
    }
    process.env.ARXIC_MODEL_BASE_URL = model.baseUrl;
    process.env.ARXIC_MODEL_API_KEY = 'g4-stub-key';
    process.env.ARXIC_STATE_DIR = stateDirectory;
    process.env.ARXIC_MAILPIT_SMTP = mailpit.smtp;
    process.env.ARXIC_MAILPIT_API = mailpit.api;
  }, 300_000);

  afterAll(async () => {
    for (const [name, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await mailpit?.stop();
    await model?.stop();
    await target?.stop();
  });

  it('completes the full CLI journey with the declaration: verified, 2 run records, per-pass login exercised twice (C-1/AC-1)', async () => {
    const running = target!;
    const personaEnvironment = {
      ARXIC_INPUT_PERSONA_EMAIL: running.persona.email,
      ARXIC_INPUT_PERSONA_PASSWORD: running.persona.password,
    };
    const outRoot = await mkdtemp(join(tmpdir(), 'arxic-288-g4-out-'));
    const configPath = await writeConfig({
      origin: running.targetOrigin,
      allowedOrigins: [running.targetOrigin, running.widgetOrigin],
      sourceDirectory,
      commit,
      declaration: true,
      mailpit: mailpit!.smtp,
    });

    const first = await run(configPath, outRoot, 'arxic-288-g4-run1', personaEnvironment);

    expect(first.exitCode).toBe(0);
    const runDirectory = join(outRoot, 'arxic-288-g4-run1');
    const runJson = JSON.parse(await readFile(join(runDirectory, 'run.json'), 'utf8')) as {
      outcome: string;
      status: string;
    };
    expect(runJson.outcome).toBe('verified');
    expect(runJson.status).toBe('completed');
    const stage10 = JSON.parse(
      await readFile(join(runDirectory, 'artifacts', '10.json'), 'utf8'),
    ) as { outcome: string; runs: Array<{ passed: boolean }> };
    expect(stage10.outcome).toBe('verified');
    expect(stage10.runs).toEqual([{ passed: true }, { passed: true }]);

    // Zero arxic-protocol traffic at all — the declaration routes fixture
    // provisioning through the target's own login form.
    expect(running.blockedRequests()).toEqual([]);
    expect(running.widgetRequests()).toContain('GET /widget.js');
    expect(running.widgetRequests()).toContain('GET /widget-ping');

    // Credential hygiene (Invariants): the persona values never surface in
    // any run artifact or diagnostic.
    const files = await allFiles(runDirectory);
    for (const file of files) {
      const bytes = await readFile(file, 'utf8').catch(() => '');
      if (bytes.length === 0) continue;
      expect(bytes, `${file} leaked a persona value`).not.toContain(running.persona.email);
      expect(bytes, `${file} leaked a persona value`).not.toContain(running.persona.password);
    }

    // G-5 statelessness half: a second run over the SAME fixed inputs and
    // REUSED out/state re-verifies identically — the per-pass login left no
    // reusable state and required no reset between runs.
    const second = await run(configPath, outRoot, 'arxic-288-g4-run2', personaEnvironment);
    expect(second.exitCode).toBe(0);
    const runDirectory2 = join(outRoot, 'arxic-288-g4-run2');
    const runJson2 = JSON.parse(await readFile(join(runDirectory2, 'run.json'), 'utf8')) as {
      outcome: string;
      status: string;
    };
    expect(runJson2.outcome).toBe('verified');
    const stage10Second = JSON.parse(
      await readFile(join(runDirectory2, 'artifacts', '10.json'), 'utf8'),
    ) as { outcome: string; runs: Array<{ passed: boolean }> };
    expect(stage10Second.outcome).toBe('verified');
    expect(stage10Second.runs).toEqual([{ passed: true }, { passed: true }]);
    expect(running.blockedRequests()).toEqual([]);
  }, 600_000);

  it('fails the stage-10 replay closed when the embedded second origin is not in target.allowedOrigins', async () => {
    const running = target!;
    const outRoot = await mkdtemp(join(tmpdir(), 'arxic-356-stage10-denied-out-'));
    const configPath = await writeConfig({
      origin: running.targetOrigin,
      allowedOrigins: [running.targetOrigin],
      sourceDirectory,
      commit,
      declaration: true,
      mailpit: mailpit!.smtp,
    });

    const result = await run(configPath, outRoot, 'arxic-356-stage10-denied', {
      ARXIC_INPUT_PERSONA_EMAIL: running.persona.email,
      ARXIC_INPUT_PERSONA_PASSWORD: running.persona.password,
    });

    expect(result.exitCode).not.toBe(0);
    const runDirectory = join(outRoot, 'arxic-356-stage10-denied');
    const diagnostics = (await readFile(join(runDirectory, 'diagnostics.jsonl'), 'utf8'))
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { code: string; severity: string; message: string });
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'ARXIC-VERIFY-RUN-FAILURE',
        severity: 'contradicted',
        message: expect.stringContaining('ARXIC-COMPILE-ORIGIN-DENIED'),
      }),
    );
  }, 600_000);

  it('refuses the undeclared endpoint-less target at stage 7 with the frozen code (G-0 regression half, C-2/AC-3)', async () => {
    const running = target!;
    const outRoot = await mkdtemp(join(tmpdir(), 'arxic-288-g4-ndecl-out-'));
    const configPath = await writeConfig({
      origin: running.targetOrigin,
      sourceDirectory,
      commit,
      declaration: false,
      mailpit: mailpit!.smtp,
    });

    const result = await run(configPath, outRoot, 'arxic-288-g4-nodecl', {
      ARXIC_INPUT_PERSONA_EMAIL: running.persona.email,
      ARXIC_INPUT_PERSONA_PASSWORD: running.persona.password,
    });

    // Refused fail-closed: non-zero exit, the frozen code, zero passes.
    expect(result.exitCode).not.toBe(0);
    const runDirectory = join(outRoot, 'arxic-288-g4-nodecl');
    const diagnostics = (await readFile(join(runDirectory, 'diagnostics.jsonl'), 'utf8'))
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { code: string; severity: string; subject: string });
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'ARXIC-VERIFY-FIXTURE-NOT-DECLARED',
        severity: 'blocked',
      }),
    );
    const stage10Path = join(runDirectory, 'artifacts', '10.json');
    const stage10 = await readFile(stage10Path, 'utf8').catch(() => 'MISSING');
    if (stage10 !== 'MISSING') {
      const parsed = JSON.parse(stage10) as { runs?: unknown[] };
      expect(parsed.runs ?? []).toEqual([]);
    }
    // The refused reset attempt is the only arxic-protocol traffic, and none
    // of it succeeded ("zero arxic-protocol POSTs beyond the refused attempt").
    const blocked = running.blockedRequests();
    expect(blocked.length).toBeGreaterThanOrEqual(1);
    expect(blocked.every((line) => /POST \/__arxic\/(reset|seed) -> 404$/u.test(line))).toBe(true);
  }, 600_000);
});

async function run(
  configPath: string,
  outRoot: string,
  runId: string,
  persona: Record<string, string>,
): Promise<{ exitCode: number }> {
  const previous: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(persona)) {
    previous[name] = process.env[name];
    process.env[name] = value;
  }
  try {
    return await runCli(['run', '--config', configPath, '--out', outRoot, '--run-id', runId], {
      cwd: root,
      rulepacksDir: join(root, 'rulepacks'),
      stdout: { write: () => undefined },
      stderr: { write: () => undefined },
      now: () => new Date().toISOString(),
    });
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function writeConfig(options: {
  origin: string;
  allowedOrigins?: string[];
  sourceDirectory: string;
  commit: string;
  declaration: boolean;
  mailpit: string;
}): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-288-g4-config-'));
  const configPath = join(directory, 'arxic.yaml');
  const replay = options.declaration
    ? `  replayPersona:
    mode: per-pass-login
    login:
      route: /login
      fields:
        - { label: Email, inputRef: persona.email }
        - { label: Password, inputRef: persona.password }
      submit: { label: Login }
`
    : '';
  const { writeFile } = await import('node:fs/promises');
  await writeFile(
    configPath,
    `version: 1
source:
  repository: ${JSON.stringify(options.sourceDirectory)}
  revision: ${JSON.stringify(options.commit)}
  languages: [typescript]
scope:
  domains: [authentication]
  frameworks: [nextjs]
  browsers: [chromium]
  personas: [registered-user]
target:
  origin: ${JSON.stringify(options.origin)}
  environmentClass: local-test
  attestationPath: /.well-known/arxic-test-target.json
  allowedOrigins: [${(options.allowedOrigins ?? [options.origin]).map((origin) => JSON.stringify(origin)).join(', ')}]
policy:
  maxUrls: 8
  maxDepth: 1
  maxRuntimeMinutes: 30
  mutation: leased-fixtures-only
  externalNetwork: deny
  requiredVerificationRuns: 2
  screenshots: transition-checkpoints
  trace: retain
  humanApproval: [destructive, external-side-effect]
fixtures:
  personaProvisioner: boot-seeded-admin
${replay}models:
  provider: gpt-4o-mini
  sourceRetention: disabled
`,
  );
  void options.mailpit;
  return configPath;
}

async function allFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: false });
  return entries
    .filter(
      (entry) => typeof entry === 'string' && !entry.endsWith('.png') && !entry.endsWith('.zip'),
    )
    .map((entry) => join(directory, entry as string))
    .concat(directory);
}
