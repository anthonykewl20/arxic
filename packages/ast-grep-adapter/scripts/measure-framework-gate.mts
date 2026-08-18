#!/usr/bin/env node
// DG-10 measurement harness: exercises the framework gate end-to-end with the
// real sg CLI, the real rulepacks, and the real committed evidence fixtures
// (campaign next lockfile — security-refreshed 2026-08-18, see the fixture
// README; koel composer.json/composer.lock at the DG-05-pinned commit), then
// writes sanitized artifacts to docs/evidence/DG-10.
//
// Usage: npx tsx packages/ast-grep-adapter/scripts/measure-framework-gate.mts <out-dir>
//
// Sanitization: artifacts carry relative paths, tiers, verdicts, and diagnostic
// codes/severities/messages only. The script FAILS if any emitted diagnostic
// contains the temporary repository root or any absolute path — the same
// no-internal-paths invariant the tests assert.

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  AstGrepAdapter,
  detectFrameworkEvidence,
  diagnosticsOf,
  evaluateFrameworkGate,
  loadPacks,
} from '../src/index.ts';

const exec = promisify(execFile);
const scriptRoot = resolve(import.meta.dirname, '..');
const workspaceRoot = resolve(scriptRoot, '../..');
const evidenceRoot = join(scriptRoot, 'src/__tests__/fixtures/framework-evidence');

const [outArgument] = process.argv.slice(2);
if (!outArgument) {
  console.error('usage: npx tsx scripts/measure-framework-gate.mts <out-dir>');
  process.exit(1);
}
const outDir = resolve(outArgument);

const gitEnvironment = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Arxic Evidence',
  GIT_AUTHOR_EMAIL: 'evidence@arxic.invalid',
  GIT_COMMITTER_NAME: 'Arxic Evidence',
  GIT_COMMITTER_EMAIL: 'evidence@arxic.invalid',
  GIT_AUTHOR_DATE: '2026-08-17T12:00:00Z',
  GIT_COMMITTER_DATE: '2026-08-17T12:00:00Z',
};

async function committedRepo(files: Record<string, string>): Promise<{
  root: string;
  commit: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'arxic-dg10-'));
  for (const [path, content] of Object.entries(files)) {
    const destination = join(root, path);
    await mkdir(resolve(destination, '..'), { recursive: true });
    await writeFile(destination, content);
  }
  await exec('git', ['init', '--initial-branch=main'], { cwd: root, env: gitEnvironment });
  await exec('git', ['add', '.'], { cwd: root, env: gitEnvironment });
  await exec('git', ['commit', '-m', 'dg10 evidence'], { cwd: root, env: gitEnvironment });
  const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd: root });
  return { root, commit: stdout.trim() };
}

async function readEvidence(relative: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  return readFile(join(evidenceRoot, relative), 'utf8');
}

async function campaignPack(parent: string): Promise<string> {
  const directory = join(parent, 'nextjs-campaign');
  const { mkdir: makeDirectory, writeFile: write } = await import('node:fs/promises');
  await makeDirectory(join(directory, 'rules'), { recursive: true });
  await write(
    join(directory, 'pack.json'),
    JSON.stringify(
      {
        id: 'nextjs-campaign',
        version: '1.0.0',
        framework: { name: 'nextjs', versions: '>=15 <16' },
        license: 'MIT',
        provenance: 'campaign-reproduction',
        ruleDir: 'rules',
      },
      null,
      2,
    ),
  );
  await write(
    join(directory, 'rules/page.yml'),
    `id: nextjs-page-route\nlanguage: Tsx\nmessage: page\nseverity: info\nrule:\n  pattern: export default async function $NAME($$$ARGS) { $$$BODY }\nmetadata:\n  arxic:\n    category: route\n    semver: 1.0.0\n    frameworkVersions: ">=15 <16"\n    precision: evidence\n    fallback: evidence\n    license: MIT\n    provenance: campaign-reproduction\n`,
  );
  return directory;
}

const page = 'export default async function LoginPage() {\n  return <main>login</main>;\n}\n';
const campaignFiles = async (
  extra: Record<string, string> = {},
): Promise<Record<string, string>> => ({
  'package.json': await readEvidence('campaign-next-16.2.6/package.json'),
  'pnpm-lock.yaml': await readEvidence('campaign-next-16.2.6/pnpm-lock.yaml'),
  'app/login/page.tsx': page,
  ...extra,
});

// Issue #278 (C-2/AC-4): expected versions derive from the fixture manifest
// read at run time — the cell-4 waiver must match the fixture's next pin for
// the waive to apply, and a future fixture bump must not touch this script.
// PR #279 review P3: the gate detects from the LOCKFILE tier, so a manifest
// pin alone must never drive expectations — mirror expectedCampaignNextVersion
// (framework-gate.test.ts, AC-3) and abort BEFORE building the matrix when the
// two fixture files disagree, instead of silently measuring a drifted fixture.
const campaignManifest = JSON.parse(await readEvidence('campaign-next-16.2.6/package.json')) as {
  dependencies: { next: string };
};
const campaignLockfile = await readEvidence('campaign-next-16.2.6/pnpm-lock.yaml');

// Same parser shape as the production reader (`pnpmLockCandidates` in
// framework-gate.ts) and its test twin `lockfileNextResolution`: the importers
// `next:` entry followed by its resolved `version:` line, with the
// peer-dependency suffix (e.g. `16.2.11(react@19.2.3)`) cut at the first `(`.
const lockfileNextResolution = (lockfile: string): string => {
  const lines = lockfile.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s{2,10}next:\s*$/u.test(lines[index]!)) continue;
    const window = lines.slice(index + 1, index + 5).join('\n');
    const resolved = window.match(/^\s+version:\s*(v?[0-9A-Za-z.-]+)/mu);
    if (resolved) return resolved[1]!;
  }
  throw new Error('no importers next resolution found in campaign-next-16.2.6/pnpm-lock.yaml');
};

const manifestPin = campaignManifest.dependencies.next;
const lockfileResolution = lockfileNextResolution(campaignLockfile);
if (manifestPin !== lockfileResolution) {
  throw new Error(
    `fixture coherence violation (AC-3): campaign-next-16.2.6/package.json pins next@${manifestPin} ` +
      `but pnpm-lock.yaml resolves next@${lockfileResolution} — regenerate the lockfile from the ` +
      `manifest (see the fixture README, issue #278) before measuring DG-10 evidence`,
  );
}
const campaignNextVersion = manifestPin;

const waiverFor = (framework: string, version: string, range: string) =>
  JSON.stringify(
    {
      version: 1,
      frameworkWaivers: [
        {
          framework,
          version,
          packVersionRange: range,
          reason: 'operator reviewed the rules against this build (DG-10 evidence run)',
          approvedBy: 'anthonykewl20',
          recordedAt: '2026-08-17T00:00:00.000Z',
        },
      ],
    },
    null,
    2,
  );

const sanitizeDiagnostics = (diagnostics: ReturnType<typeof diagnosticsOf>) =>
  diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    severity: diagnostic.severity,
    subject: diagnostic.subject,
    message: diagnostic.message,
  }));

const sanitizeRef = (ref: {
  path: string;
  startLine: number;
  endLine: number;
  ruleId?: string;
  blobSha256: string;
}) => ({
  path: ref.path,
  startLine: ref.startLine,
  endLine: ref.endLine,
  ...(ref.ruleId === undefined ? {} : { ruleId: ref.ruleId }),
  blobSha256: `${ref.blobSha256.slice(0, 12)}…`,
});

const assertNoInternalPaths = (text: string, roots: string[]) => {
  for (const root of roots)
    if (text.includes(root))
      throw new Error(`artifact leaks internal path ${root}: ${text.slice(0, 200)}`);
};

const packParent = await mkdtemp(join(tmpdir(), 'arxic-dg10-packs-'));
const campaignPackDir = await campaignPack(packParent);
const shippedPacks = [
  join(workspaceRoot, 'rulepacks/nextjs'),
  join(workspaceRoot, 'rulepacks/express'),
];

const matrix: unknown[] = [];
const roots: string[] = [packParent];

async function recordScenario(name: string, run: () => Promise<unknown>) {
  const entry = await run();
  matrix.push({ scenario: name, ...entry });
}

// Cell 1 — acceptance inside the shipped range (lockfile evidence).
await recordScenario('cell-1-accept', async () => {
  const repo = await committedRepo(await campaignFiles());
  roots.push(repo.root);
  const result = await new AstGrepAdapter({ packs: shippedPacks.slice(0, 1) }).scan({
    revision: { repository: pathToFileURL(repo.root).href, commit: repo.commit, dirty: false },
    framework: 'nextjs',
  });
  return {
    verdict: 'accepted',
    matchedRules: result.matches.length,
    frameworks: result.frameworks!.map((framework) => ({
      name: framework.name,
      version: framework.version,
      tier: framework.tier,
      evidence: framework.evidence.map(sanitizeRef),
    })),
    diagnostics: sanitizeDiagnostics(diagnosticsOf(result.events)),
  };
});

// Cell 2 — the campaign rejection (fixture next pin vs the historical >=15 <16).
await recordScenario('cell-2-reject-campaign', async () => {
  const repo = await committedRepo(await campaignFiles());
  roots.push(repo.root);
  const result = await new AstGrepAdapter({ packs: [campaignPackDir] }).scan({
    revision: { repository: pathToFileURL(repo.root).href, commit: repo.commit, dirty: false },
    framework: 'nextjs',
  });
  return {
    verdict: 'rejected',
    matchedRules: result.matches.length,
    diagnostics: sanitizeDiagnostics(diagnosticsOf(result.events)),
    evidenceRefs: result.events
      .filter((event) => 'ref' in event)
      .map((event) => sanitizeRef((event as { ref: Parameters<typeof sanitizeRef>[0] }).ref)),
  };
});

// Cell 3 — unknown framework (the issue's frameworks:[laravel] scenario).
await recordScenario('cell-3-unknown', async () => {
  const repo = await committedRepo({ 'app/login/page.tsx': page });
  roots.push(repo.root);
  const result = await new AstGrepAdapter({ packs: shippedPacks }).scan({
    revision: { repository: pathToFileURL(repo.root).href, commit: repo.commit, dirty: false },
    framework: 'laravel',
  });
  return {
    verdict: 'unknown',
    matchedRules: result.matches.length,
    diagnostics: sanitizeDiagnostics(diagnosticsOf(result.events)),
  };
});

// Cell 4 — recorded waiver unblocks the campaign rejection.
await recordScenario('cell-4-waived', async () => {
  const repo = await committedRepo(
    await campaignFiles({
      'arxic.waivers.json': waiverFor('nextjs', campaignNextVersion, '>=15 <16'),
    }),
  );
  roots.push(repo.root);
  const result = await new AstGrepAdapter({ packs: [campaignPackDir] }).scan({
    revision: { repository: pathToFileURL(repo.root).href, commit: repo.commit, dirty: false },
    framework: 'nextjs',
  });
  return {
    verdict: 'waived',
    matchedRules: result.matches.length,
    diagnostics: sanitizeDiagnostics(diagnosticsOf(result.events)),
    waiverEvidence: result.events
      .filter(
        (event) =>
          'ref' in event && (event as { ref: { path: string } }).ref.path === 'arxic.waivers.json',
      )
      .map((event) => sanitizeRef((event as { ref: Parameters<typeof sanitizeRef>[0] }).ref)),
  };
});

// Waiver abuse — version and range must both match for the waiver to apply.
await recordScenario('waiver-abuse-wrong-version', async () => {
  const repo = await committedRepo(
    await campaignFiles({ 'arxic.waivers.json': waiverFor('nextjs', '15.9.0', '>=15 <16') }),
  );
  roots.push(repo.root);
  const result = await new AstGrepAdapter({ packs: [campaignPackDir] }).scan({
    revision: { repository: pathToFileURL(repo.root).href, commit: repo.commit, dirty: false },
    framework: 'nextjs',
  });
  return {
    verdict: 'rejected',
    matchedRules: result.matches.length,
    diagnostics: sanitizeDiagnostics(diagnosticsOf(result.events)),
  };
});

// Deterministic detection across tiers on the real third-party evidence.
const koelFiles = {
  'composer.json': await readEvidence('koel/composer.json'),
  'composer.lock': await readEvidence('koel/composer.lock'),
};
const koelRepo = await committedRepo(koelFiles);
roots.push(koelRepo.root);
const koelDetection = await detectFrameworkEvidence({
  root: koelRepo.root,
  repository: pathToFileURL(koelRepo.root).href,
  commit: koelRepo.commit,
});
const koelPacks = await loadPacks(shippedPacks);
const koelGate = evaluateFrameworkGate({
  frameworks: ['laravel'],
  packs: koelPacks.packs,
  detection: koelDetection,
});
const detectionArtifact = {
  label: 'koel/koel @ dfec91ff290509c622ff7cf392fb5e506841ee2b (MIT; DG-05-pinned commit)',
  sources: ['composer.json (real, complete)', 'composer.lock (real excerpt: laravel/framework)'],
  detected: koelDetection.frameworks.map((framework) => ({
    name: framework.name,
    version: framework.version,
    declaredRange: framework.declaredRange,
    tier: framework.tier,
    evidence: framework.evidence.map(sanitizeRef),
  })),
  gateVerdicts: koelGate.verdicts,
  gateDiagnostics: sanitizeDiagnostics(koelGate.diagnostics),
};

// No path leaks anywhere: the artifact invariant.
for (const entry of matrix) assertNoInternalPaths(JSON.stringify(entry), roots);
assertNoInternalPaths(JSON.stringify(detectionArtifact), roots);

await mkdir(join(outDir), { recursive: true });
await writeFile(join(outDir, 'matrix.json'), `${JSON.stringify(matrix, null, 2)}\n`);
await writeFile(
  join(outDir, 'koel-detection.json'),
  `${JSON.stringify(detectionArtifact, null, 2)}\n`,
);

await Promise.all([rm(koelRepo.root, { recursive: true, force: true })]);
console.log(`wrote ${join(outDir, 'matrix.json')} (${matrix.length} scenarios)`);
console.log(`wrote ${join(outDir, 'koel-detection.json')}`);
console.log(
  `sanitization: no internal paths in any artifact (asserted against ${roots.length} roots)`,
);
console.log(`campaign pack id: ${basename(campaignPackDir)}`);
