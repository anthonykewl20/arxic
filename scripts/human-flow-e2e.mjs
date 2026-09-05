import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = dirname(scriptDirectory);
const fixtureSource = join(repositoryRoot, 'test-fixtures', 'reference-auth-app');
const playwrightInstallCommand = [
  '--yes',
  '--package=playwright@1.62.1',
  'playwright',
  'install',
  'chromium',
];

export function createConfig({ origin, repository, revision, requiredVerificationRuns = 2 }) {
  return `version: 1
source:
  repository: ${JSON.stringify(repository)}
  revision: ${JSON.stringify(revision)}
  languages: [typescript, javascript]
scope:
  domains: [authentication]
  frameworks: [nextjs]
  browsers: [chromium]
  personas: [anonymous, registered-user]
  featureFlags:
    passwordReset: true
target:
  origin: ${JSON.stringify(origin)}
  environmentClass: local-test
  attestationPath: /.well-known/arxic-test-target.json
  allowedOrigins: [${JSON.stringify(origin)}]
policy:
  maxUrls: 8
  maxDepth: 1
  maxRuntimeMinutes: 30
  mutation: leased-fixtures-only
  externalNetwork: deny
  requiredVerificationRuns: ${requiredVerificationRuns}
  screenshots: transition-checkpoints
  trace: retain
  humanApproval: [destructive, external-side-effect]
fixtures:
  personaProvisioner: app-seed-api
models:
  provider: gpt-4o-mini
  sourceRetention: disabled
`;
}

export function stableRunRoot(stateDirectory, repository) {
  return join(
    resolve(stateDirectory),
    'runs',
    createHash('sha256').update(resolve(repository)).digest('hex').slice(0, 16),
  );
}

export function assertSuccessfulRun({ exitCode, output, run, bundle }) {
  if (exitCode !== 0) throw new Error(`happy run exited ${exitCode}`);
  if (!/status=completed, outcome=verified\)/u.test(output)) {
    throw new Error('happy run did not report completed verified output');
  }
  if (run.outcome !== 'verified' || run.status !== 'completed') {
    throw new Error('run record did not report a verified completed outcome');
  }
  if (bundle?.manifest?.workflow?.status !== 'verified') {
    throw new Error('promoted bundle manifest must record a verified workflow');
  }
  if (
    !bundle.workflow?.transitions?.some(({ from, to }) => from === 'login-page' && to === 'home')
  ) {
    throw new Error('Verified login did not reach the signed-in reference-app state');
  }
}

export function assertBlockedRun({ exitCode, run, diagnostics, priorBundle, currentBundle }) {
  if (exitCode !== 1) throw new Error(`sad run exited ${exitCode}`);
  if (run.outcome !== 'blocked' || run.status !== 'failed') {
    throw new Error('sad run did not produce a blocked failed record');
  }
  if (!diagnostics.some((diagnostic) => diagnostic.severity === 'blocked')) {
    throw new Error('sad run did not emit a blocked diagnostic');
  }
  if (!Buffer.from(priorBundle).equals(Buffer.from(currentBundle))) {
    throw new Error('prior promoted bundle changed after blocked run');
  }
}

export async function runHumanFlow({ keep = false, evidenceDirectory } = {}) {
  const timings = [];
  const startedAt = Date.now();
  const cleanRoom = await mkdtemp(join(tmpdir(), 'arxic-human-flow-'));
  const paths = {
    cleanRoom,
    home: join(cleanRoom, 'home'),
    install: join(cleanRoom, 'install'),
    app: join(cleanRoom, 'reference-auth-app'),
    state: join(cleanRoom, 'state'),
    tarballs: join(cleanRoom, 'tarballs'),
  };
  let app;
  let model;
  let outcome;
  try {
    await phase(timings, 'clean-room-install', async () => {
      await Promise.all(Object.values(paths).map((path) => mkdirp(path)));
      await command('npm', ['pack', '--pack-destination', paths.tarballs], {
        cwd: join(repositoryRoot, 'apps', 'cli'),
        env: cleanEnvironment(paths),
        timeout: 180_000,
      });
      const tarballs = (await readdir(paths.tarballs)).filter((file) => file.endsWith('.tgz'));
      if (tarballs.length !== 1) throw new Error('npm pack did not create exactly one CLI tarball');
      await command('npm', ['install', '--no-package-lock', join(paths.tarballs, tarballs[0])], {
        cwd: paths.install,
        env: cleanEnvironment(paths),
        timeout: 180_000,
      });
      await command('npx', playwrightInstallCommand, {
        cwd: paths.install,
        env: cleanEnvironment(paths),
        timeout: 300_000,
      });
      await command(
        'node',
        [
          '-e',
          `
        const { createRequire } = require('node:module');
        const req = createRequire(require.resolve('arxic/package.json'));
        const Parser = req('tree-sitter');
        const parser = new Parser();
        parser.setLanguage(req('tree-sitter-php').php);
        const tree = parser.parse('<?php function release_probe() { return 42; }');
        if (tree.rootNode.hasError || tree.rootNode.type !== 'program') process.exit(1);
      `,
        ],
        { cwd: paths.install, env: cleanEnvironment(paths), timeout: 30_000 },
      );
    });

    const appPort = await freePort();
    const origin = `http://127.0.0.1:${appPort}`;
    const persona = {
      id: 'human-flow-user',
      email: 'human-flow@example.test',
      password: 'HumanFlow9!',
    };
    let revision;
    await phase(timings, 'user-app', async () => {
      await cp(fixtureSource, paths.app, {
        recursive: true,
        filter: (path) => !['node_modules', '.next', 'dist'].includes(basename(path)),
      });
      await command('npm', ['install'], {
        cwd: paths.app,
        env: cleanEnvironment(paths),
        timeout: 300_000,
      });
      revision = await initializeFixtureRepository(paths.app, cleanEnvironment(paths));
      await command('npm', ['run', 'build'], {
        cwd: paths.app,
        env: cleanEnvironment(paths),
        timeout: 240_000,
      });
      await mkdirp(join(cleanRoom, 'runtime'));
      app = spawn(
        process.execPath,
        [
          join(paths.app, 'node_modules', 'next', 'dist', 'bin', 'next'),
          'start',
          '-H',
          '127.0.0.1',
          '-p',
          String(appPort),
        ],
        {
          cwd: paths.app,
          env: {
            ...cleanEnvironment(paths),
            ARXIC_TARGET_ORIGIN: origin,
            ARXIC_ATTESTATION_NONCE: 'human-flow-attestation',
            ARXIC_DB_PATH: join(cleanRoom, 'runtime', 'auth.db'),
          },
          stdio: 'ignore',
        },
      );
      await waitForReady(origin, app);
      await resetAndSeed(origin, persona);
    });

    const modelRequests = [];
    await phase(timings, 'model-endpoint', async () => {
      model = await startModel(modelRequests);
    });

    const configPath = join(paths.install, 'arxic.yaml');
    await writeFile(
      configPath,
      createConfig({ origin, repository: paths.app, revision, requiredVerificationRuns: 3 }),
      'utf8',
    );
    const runId = `human-happy-${randomUUID()}`;
    const cli = join(
      paths.install,
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'arxic.cmd' : 'arxic',
    );
    const runEnvironment = {
      ...cleanEnvironment(paths),
      ARXIC_STATE_DIR: paths.state,
      ARXIC_MODEL_BASE_URL: model.baseUrl,
      ARXIC_MODEL_API_KEY: 'human-flow-model-key',
      ARXIC_INPUT_PERSONA_EMAIL: persona.email,
      ARXIC_INPUT_PERSONA_PASSWORD: persona.password,
    };
    let happy;
    await phase(timings, 'packed-local-run', async () => {
      happy = await processResult(cli, ['run', '--config', 'arxic.yaml', '--run-id', runId], {
        cwd: paths.install,
        env: runEnvironment,
        timeout: 420_000,
      });
    });
    const runRoot = stableRunRoot(paths.state, paths.app);
    const happyDirectory = join(runRoot, runId);
    const promotedPath = join(runRoot, 'promoted', `${runId}.bundle.json`);
    const bundleDirectory = join(runRoot, 'promoted', `${runId}.bundle`);
    const happyRun = await readJson(join(happyDirectory, 'run.json'));
    const happyDiagnostics = await readDiagnostics(happyDirectory);
    if (
      happy.exitCode !== 0 ||
      happyRun.outcome !== 'verified' ||
      happyRun.status !== 'completed'
    ) {
      throw new Error(
        `Packed CLI did not reach promotion: exit=${happy.exitCode}, status=${happyRun.status}, outcome=${happyRun.outcome}, diagnostics=${happyDiagnostics.map(({ code }) => code).join(',')}`,
      );
    }
    const promotedBundle = await readJson(promotedPath);
    await phase(timings, 'happy-assertions', async () => {
      assertSuccessfulRun({ ...happy, run: happyRun, bundle: promotedBundle });
      assertDiagnostics(happy.output);
      assertManifestSchema(promotedBundle.manifest);
      if (
        promotedBundle.manifest.verification.requiredRuns !== 3 ||
        promotedBundle.manifest.verification.runs.length !== 3
      ) {
        throw new Error(
          'Configured three clean verification passes were not retained in the bundle',
        );
      }
      await assertRunDirectory(happyDirectory, paths.app);
      await assertBundleDirectory(bundleDirectory, promotedBundle.manifest);
      if (modelRequests.length === 0)
        throw new Error('packed CLI did not contact the model endpoint');
      if (
        !modelRequests.every((request) => request.authorization === 'Bearer human-flow-model-key')
      ) {
        throw new Error('model endpoint did not receive the configured bearer credential');
      }
      if (!modelRequests.every((request) => request.structuredOutput === true)) {
        throw new Error('model endpoint did not receive a structured-output request');
      }
      if (!happyDiagnostics.every((diagnostic) => /^ARXIC-[A-Z0-9-]+$/u.test(diagnostic.code))) {
        throw new Error('happy diagnostics did not use frozen ARXIC codes');
      }
    });

    await phase(timings, 'independent-bundle-replay', async () => {
      const replay = join(paths.install, 'standalone-replay');
      await cp(bundleDirectory, replay, { recursive: true });
      const timestamp = new Date().toISOString();
      const policy = JSON.stringify(
        canonicalize({
          schemaVersion: 1,
          id: 'release-398-standalone',
          authority: {
            kind: 'repository-policy',
            reference: 'scripts/human-flow-e2e.mjs',
            recordedAt: timestamp,
          },
          capture: {
            mode: 'masked-page',
            fullPage: true,
            masks: [{ kind: 'role', role: 'main', exact: true }],
          },
        }),
      );
      const replayEnv = {
        ...runEnvironment,
        ARXIC_SCREENSHOT_PRIVACY_POLICY: policy,
        ARXIC_SCREENSHOT_PRIVACY_POLICY_SHA256: createHash('sha256').update(policy).digest('hex'),
        ARXIC_SCREENSHOT_CAPTURE_CORRELATION: randomUUID(),
        ARXIC_SCREENSHOT_CAPTURED_AT: timestamp,
      };
      const runner = join(paths.install, 'node_modules', '@playwright', 'test', 'cli.js');
      await resetAndSeed(origin, persona);
      const good = await processResult(process.execPath, [runner, 'test', '--timeout=10000'], {
        cwd: replay,
        env: replayEnv,
        timeout: 60_000,
      });
      if (good.exitCode !== 0 || !/1 passed/u.test(good.output))
        throw new Error('Relocated bundle failed independent Playwright replay');
      await resetAndSeed(origin, persona);
      const bad = await processResult(process.execPath, [runner, 'test', '--timeout=10000'], {
        cwd: replay,
        env: { ...replayEnv, ARXIC_INPUT_PERSONA_PASSWORD: 'Incorrect398!' },
        timeout: 60_000,
      });
      if (bad.exitCode !== 1 || !/1 failed/u.test(bad.output))
        throw new Error('Wrong credentials did not fail independent replay');
      const results = await filesUnder(join(replay, 'artifacts', 'test-results'));
      if (results.some((path) => path.endsWith('.zip')))
        throw new Error('Independent failed replay retained a raw trace');
    });

    let sad;
    const priorBundle = await readFile(promotedPath);
    const unreachableOrigin = `http://127.0.0.1:${await freePort()}`;
    await writeFile(
      join(paths.install, 'unreachable.yaml'),
      createConfig({ origin: unreachableOrigin, repository: paths.app, revision }),
      'utf8',
    );
    const sadId = `human-sad-${randomUUID()}`;
    await phase(timings, 'sad-path', async () => {
      sad = await processResult(cli, ['run', '--config', 'unreachable.yaml', '--run-id', sadId], {
        cwd: paths.install,
        env: runEnvironment,
        timeout: 120_000,
      });
    });
    const sadDirectory = join(runRoot, sadId);
    const sadRun = await readJson(join(sadDirectory, 'run.json'));
    const sadDiagnostics = await readDiagnostics(sadDirectory);
    await phase(timings, 'sad-assertions', async () => {
      assertBlockedRun({
        ...sad,
        run: sadRun,
        diagnostics: sadDiagnostics,
        priorBundle,
        currentBundle: await readFile(promotedPath),
      });
      assertDiagnostics(sad.output);
    });

    if (evidenceDirectory) {
      await phase(timings, 'evidence-export', () =>
        exportEvidence({
          evidenceDirectory: resolve(evidenceDirectory),
          happyDirectory,
          bundleDirectory,
          happyDiagnostics,
          promotedBundle,
          modelRequests,
          timings,
        }),
      );
    }
    outcome = {
      ok: true,
      cleanRoom: keep ? cleanRoom : undefined,
      phases: timings,
      totalMs: Date.now() - startedAt,
      modelRequests: modelRequests.length,
    };
    if (evidenceDirectory) {
      await writeEvidenceSummary({
        evidenceDirectory: resolve(evidenceDirectory),
        modelRequests,
        outcome,
        promotedBundle,
      });
    }
    return outcome;
  } catch (error) {
    outcome = {
      ok: false,
      cleanRoom: keep ? cleanRoom : undefined,
      phases: timings,
      totalMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
    throw error;
  } finally {
    await Promise.all([stopChild(app), model?.close()]);
    if (!keep) await rm(cleanRoom, { recursive: true, force: true });
    printVerdict(outcome ?? { ok: false, phases: timings, totalMs: Date.now() - startedAt });
  }
}

function cleanEnvironment(paths) {
  return { ...process.env, HOME: paths.home, USERPROFILE: paths.home, npm_config_yes: 'true' };
}

async function initializeFixtureRepository(directory, env) {
  await command('git', ['init', '--initial-branch=main'], { cwd: directory, env });
  await command('git', ['add', '.'], { cwd: directory, env });
  await command(
    'git',
    [
      '-c',
      'user.name=Arxic Human Flow',
      '-c',
      'user.email=human-flow@example.test',
      'commit',
      '-m',
      'reference fixture',
    ],
    { cwd: directory, env },
  );
  return (await command('git', ['rev-parse', 'HEAD'], { cwd: directory, env })).stdout.trim();
}

async function command(file, args, options) {
  return execute(file, args, {
    ...options,
    maxBuffer: 10 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
}

async function processResult(file, args, options) {
  try {
    const result = await command(file, args, options);
    return { exitCode: 0, output: `${result.stdout}\n${result.stderr}` };
  } catch (error) {
    if (typeof error === 'object' && error !== null && typeof error.code === 'number') {
      return { exitCode: error.code, output: `${error.stdout ?? ''}\n${error.stderr ?? ''}` };
    }
    throw error;
  }
}

async function startModel(requests) {
  const server = createServer(async (request, response) => {
    const body = await readRequest(request);
    const parsed = JSON.parse(body);
    requests.push({
      method: request.method,
      path: request.url,
      authorization: request.headers.authorization,
      structuredOutput: parsed.response_format?.json_schema?.strict === true,
    });
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        id: `chatcmpl-human-flow-${requests.length}`,
        model: 'human-flow-local-model',
        choices: [
          {
            message: {
              role: 'assistant',
              content: JSON.stringify(modelStubOutput(parsed.messages)),
            },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  });
  await listen(server);
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('model endpoint did not bind a TCP port');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    },
  };
}

/** A model-boundary stub; proposals cite actual rows supplied by the packed CLI. */
export function modelStubOutput(messages) {
  const inventoryMessage = messages.find(
    (message) => message.role === 'user' && message.content.includes('INVENTORY_DATA'),
  );
  const inventory = inventoryMessage?.content.match(
    /INVENTORY_DATA[^\n]*\n([\s\S]*?)\nEND_INVENTORY_DATA/u,
  )?.[1];
  if (!inventory) throw new Error('Model stub did not receive the current inventory contract');
  const row = JSON.parse(inventory).find((item) => item.path === '/login' && item.method === 'GET');
  return {
    schemaVersion: 'arxic-intent-proposal-v1',
    proposals: row
      ? [
          {
            domain: 'authentication',
            intent: 'log in with credentials',
            action: `perform ${row.method} ${row.path}`,
            fromState: 'signed-out',
            toState: 'signed-in',
            persona: 'registered-user',
            inventoryRowIds: [row.id],
            evidenceRefIds: row.evidenceRefIds,
            rationale: 'Reference-app login hypothesis grounded in the supplied inventory row',
          },
        ]
      : [],
  };
}

async function exportEvidence({
  evidenceDirectory,
  bundleDirectory,
  happyDiagnostics,
  promotedBundle,
  modelRequests,
}) {
  await rm(evidenceDirectory, { recursive: true, force: true });
  await mkdirp(evidenceDirectory);
  await writeFile(
    join(evidenceDirectory, 'diagnostics.jsonl'),
    `${happyDiagnostics.map(JSON.stringify).join('\n')}\n`,
  );
  await writeFile(
    join(evidenceDirectory, 'bundle-manifest.json'),
    `${JSON.stringify(promotedBundle.manifest, null, 2)}\n`,
  );
  await writeFile(
    join(evidenceDirectory, 'model-stub-request-log.json'),
    `${JSON.stringify(
      modelRequests.map(({ authorization, ...request }) => ({
        ...request,
        authorizationPresent: Boolean(authorization),
      })),
      null,
      2,
    )}\n`,
  );
  const screenshotsDirectory = join(bundleDirectory, 'artifacts', 'screenshots');
  const screenshots = await filesUnder(screenshotsDirectory);
  for (const screenshot of screenshots.filter(
    (path) => path.endsWith('.png') || path.endsWith('.png.privacy.json'),
  )) {
    const target = join(
      evidenceDirectory,
      'screenshots',
      relative(screenshotsDirectory, screenshot),
    );
    await mkdirp(dirname(target));
    await cp(screenshot, target);
  }
  const tracesDirectory = join(bundleDirectory, 'artifacts', 'traces');
  for (const trace of await filesUnder(tracesDirectory)) {
    if (!trace.endsWith('.zip')) continue;
    const name = basename(trace);
    const provenance = join(bundleDirectory, 'artifacts', 'reports', `${name}.sanitization.json`);
    await mkdirp(join(evidenceDirectory, 'timelines'));
    await cp(trace, join(evidenceDirectory, 'timelines', name));
    await cp(provenance, join(evidenceDirectory, 'timelines', `${name}.sanitization.json`));
  }
}

async function writeEvidenceSummary({ evidenceDirectory, modelRequests, outcome, promotedBundle }) {
  await writeFile(
    join(evidenceDirectory, 'summary.md'),
    `# Packed CLI release E2E evidence\n\nThe packed CLI was installed into a temporary clean room, drove the independently installed reference app (fixture personas) through a controlled model-boundary HTTP stub and real Chromium, then completed a blocked unreachable-origin run without changing the prior promoted bundle. Screenshots use fixture data and capture-time masking, with adjacent privacy attestations. Automated inspection cannot discharge the human release sign-off. No fresh live-provider campaign is claimed. No raw traces are retained.\n\n## Versions\n\n- Node: ${process.version}\n- Arxic bundle generator: ${promotedBundle.manifest.generator.id}@${promotedBundle.manifest.generator.version}\n- Playwright: 1.62.1\n\n## Pass/fail\n\n| Check | Result |\n| --- | --- |\n| Packed local run reaches signed-in home with three clean verifier passes | pass |\n| Installed native PHP grammar parses real PHP and appears in the bundle SBOM | pass |\n| Relocated bundle passes independent Playwright replay | pass |\n| Wrong credentials fail replay without raw trace retention | pass |\n| Model stub receives a structured HTTP request | pass |\n| Promoted bundle validates and retains screenshots | pass |\n| Unreachable origin is blocked and preserves prior bundle | pass |\n\n## Timings\n\n${outcome.phases.map((item) => `- ${item.name}: ${item.durationMs} ms`).join('\n')}\n\n## Model endpoint proof\n\n` +
      '```json\n' +
      `${JSON.stringify(
        modelRequests.map(({ authorization, ...request }) => ({
          ...request,
          authorizationPresent: Boolean(authorization),
        })),
        null,
        2,
      )}\n` +
      `\`\`\`\n\n## Final output\n\n\`\`\`text\n${formatVerdict(outcome)}\n\`\`\`\n`,
  );
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  return value;
}

function assertDiagnostics(output) {
  if (
    /\n\s+at\s/u.test(output) ||
    /(?:Error:|ERR_MODULE_NOT_FOUND|Cannot find module)/u.test(output)
  ) {
    throw new Error('CLI output exposed a stack trace or runtime exception');
  }
}

function assertManifestSchema(manifest) {
  const required = [
    'schemaVersion',
    'bundleVersion',
    'workflow',
    'repository',
    'commit',
    'appBuildDigest',
    'environment',
    'generator',
    'verification',
    'fileHashes',
    'gateResults',
    'coverage',
    'runId',
  ];
  if (!manifest || typeof manifest !== 'object' || required.some((field) => !(field in manifest))) {
    throw new Error('promoted manifest failed frozen required-field validation');
  }
  if (
    !Number.isInteger(manifest.schemaVersion) ||
    !Number.isInteger(manifest.bundleVersion) ||
    manifest.workflow?.status !== 'verified' ||
    !/^[0-9a-f]{40}$/u.test(manifest.commit) ||
    !/^[0-9a-f]{64}$/u.test(manifest.appBuildDigest) ||
    !Array.isArray(manifest.fileHashes) ||
    manifest.fileHashes.length === 0 ||
    !Array.isArray(manifest.gateResults) ||
    manifest.gateResults.some(
      (gate) => typeof gate.gate !== 'string' || typeof gate.passed !== 'boolean',
    )
  ) {
    throw new Error('promoted manifest failed frozen schema type validation');
  }
}

async function assertRunDirectory(directory, sourceDirectory) {
  if (resolve(directory).startsWith(`${resolve(sourceDirectory)}/`))
    throw new Error('run directory leaked into source tree');
  for (const path of ['run.json', 'diagnostics.jsonl', 'config.json', 'stages']) {
    await stat(join(directory, path));
  }
  if ((await readdir(join(directory, 'stages'))).length < 13)
    throw new Error('run directory does not contain stages 0 through 12');
}

async function assertBundleDirectory(directory, promotedManifest) {
  for (const path of [
    'manifest.json',
    'workflow.json',
    'evidence/index.json',
    'checksums.sha256',
  ]) {
    await stat(join(directory, path));
  }
  const manifest = await readJson(join(directory, 'manifest.json'));
  assertManifestSchema(manifest);
  if (JSON.stringify(manifest) !== JSON.stringify(promotedManifest)) {
    throw new Error('assembled bundle manifest does not match the promoted bundle manifest');
  }
  const screenshots = await filesUnder(join(directory, 'artifacts', 'screenshots'));
  if (!screenshots.some((path) => path.endsWith('.png'))) {
    throw new Error('assembled bundle contains no screenshots');
  }
  for (const screenshot of screenshots.filter((path) => path.endsWith('.png'))) {
    await stat(`${screenshot}.privacy.json`);
  }
  const sbom = await readJson(join(directory, 'sbom.cdx.json'));
  if (
    sbom.bomFormat !== 'CycloneDX' ||
    !sbom.components?.some(({ name }) => name === 'tree-sitter-php')
  )
    throw new Error('Bundle SBOM omits the installed PHP grammar');
  const checksums = await readFile(join(directory, 'checksums.sha256'), 'utf8');
  if (!checksums.includes('  manifest.json\n') || !checksums.includes('  workflow.json\n')) {
    throw new Error('assembled bundle checksums omit required bundle files');
  }
}

async function readDiagnostics(directory) {
  const bytes = await readFile(join(directory, 'diagnostics.jsonl'), 'utf8');
  return bytes
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function resetAndSeed(origin, persona) {
  const reset = await fetch(`${origin}/__arxic/reset`, { method: 'POST' });
  if (reset.status !== 204) throw new Error(`reference-app reset returned ${reset.status}`);
  const seed = await fetch(`${origin}/__arxic/seed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      personaId: persona.id,
      email: persona.email,
      password: persona.password,
    }),
  });
  if (seed.status !== 201) throw new Error(`reference-app seed returned ${seed.status}`);
}

async function waitForReady(origin, child) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`reference app exited with ${child.exitCode}`);
    try {
      if ((await fetch(origin)).ok) return;
    } catch {
      // A real app start may not have bound its ephemeral port yet.
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error('reference app readiness timed out');
}

async function freePort() {
  const server = createNetServer();
  await listen(server);
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('could not allocate an ephemeral port');
  await new Promise((done) => server.close(done));
  return address.port;
}

async function listen(server) {
  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', done);
  });
}

async function readRequest(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? filesUnder(path) : [path];
      }),
    )
  ).flat();
}

async function mkdirp(path) {
  await (await import('node:fs/promises')).mkdir(path, { recursive: true });
}

async function phase(timings, name, action) {
  const started = Date.now();
  await action();
  timings.push({ name, durationMs: Date.now() - started });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((done) => child.once('exit', done)),
    new Promise((done) => setTimeout(done, 5_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

function printVerdict(outcome) {
  console.log(formatVerdict(outcome));
}

function formatVerdict(outcome) {
  return [
    `HUMAN-FLOW-E2E ${outcome.ok ? 'PASS' : 'FAIL'}`,
    ...outcome.phases.map((phase) => `phase=${phase.name} durationMs=${phase.durationMs}`),
    `totalMs=${outcome.totalMs}`,
    ...(outcome.modelRequests === undefined ? [] : [`modelRequests=${outcome.modelRequests}`]),
    ...(outcome.error ? [`error=${outcome.error}`] : []),
    ...(outcome.cleanRoom ? [`cleanRoom=${outcome.cleanRoom}`] : []),
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const keep = process.argv.includes('--keep');
  const evidenceFlag = process.argv.indexOf('--evidence-dir');
  const evidenceDirectory = evidenceFlag === -1 ? undefined : process.argv[evidenceFlag + 1];
  if (evidenceFlag !== -1 && !evidenceDirectory) {
    console.error('--evidence-dir requires a path');
    process.exitCode = 2;
  } else {
    runHumanFlow({ keep, evidenceDirectory }).catch(() => {
      process.exitCode = 1;
    });
  }
}
