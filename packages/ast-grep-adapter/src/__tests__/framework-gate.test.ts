import { readFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateDiagnostic, validateEvidenceRef } from '@arxic/contracts';
import { describe, expect, it } from 'vitest';
import {
  ARXIC_RULES_FRAMEWORK_ACCEPTED,
  ARXIC_RULES_FRAMEWORK_REJECTED,
  ARXIC_RULES_FRAMEWORK_UNKNOWN,
  ARXIC_RULES_FRAMEWORK_UNDETECTED,
  ARXIC_RULES_FRAMEWORK_WAIVED,
  ARXIC_RULES_WAIVER_INVALID,
  AstGrepAdapter,
  detectFrameworkEvidence,
  diagnosticsOf,
} from '..';
import { makeRepository, packDirs, writePack, workspaceRoot } from './test-repo';

const fixtureRoot = join(workspaceRoot, 'packages/ast-grep-adapter/src/__tests__/fixtures');
const evidenceRoot = join(fixtureRoot, 'framework-evidence');

async function campaignFiles(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  return {
    // Real pnpm 11 lockfile resolving next@16.2.6 from the npm registry plus the
    // matching manifest pin — the ADR-008 campaign shape, reproduced honestly.
    'package.json': await readFile(join(evidenceRoot, 'campaign-next-16.2.6/package.json'), 'utf8'),
    'pnpm-lock.yaml': await readFile(
      join(evidenceRoot, 'campaign-next-16.2.6/pnpm-lock.yaml'),
      'utf8',
    ),
    'app/login/page.tsx':
      'export default async function LoginPage() {\n  return <main>login</main>;\n}\n',
    ...extra,
  };
}

// The nextjs-auth range as it stood during the 2026-08-16 campaign: the pack
// declared >=15 <16 while the app ran Next 16.2.6 (ADR-008 Context). The rule is
// the real nextjs-page-route pattern from rulepacks/nextjs/rules/page-route.yml.
async function campaignPack(parent: string): Promise<string> {
  return writePack(
    parent,
    'nextjs-campaign',
    'nextjs-page-route',
    false,
    { name: 'nextjs', versions: '>=15 <16' },
    {
      language: 'Tsx',
      pattern: 'export default async function $NAME($$$ARGS) { $$$BODY }',
    },
  );
}

// PR #272 P2: the shipped-pack waiver-voiding scenario. next 17.0.0 sits
// outside the shipped nextjs-auth range (>=15 <17), so an out-of-range
// verdict is certain and only a waiver recorded against the CURRENT pack
// range can unblock it — exactly where a silently-voided waiver bites.
function next17WaiverFiles(packVersionRange: string): Record<string, string> {
  return {
    'package.json': JSON.stringify(
      { name: 'next-17-app', dependencies: { next: '17.0.0' } },
      undefined,
      2,
    ),
    'app/login/page.tsx':
      'export default async function LoginPage() {\n  return <main>login</main>;\n}\n',
    'arxic.waivers.json': JSON.stringify(
      {
        version: 1,
        frameworkWaivers: [
          {
            framework: 'nextjs',
            version: '17.0.0',
            packVersionRange,
            reason: `operator reviewed nextjs-auth rules against Next 17 (${packVersionRange} pack)`,
            approvedBy: 'anthonykewl20',
            recordedAt: '2026-08-17T00:00:00.000Z',
          },
        ],
      },
      undefined,
      2,
    ),
  };
}

describe('Decision 9 four-cell matrix: framework+version detection enforces pack ranges', () => {
  it('cell 1 — declared-range acceptance: next 16.2.6 inside the shipped nextjs range is accepted with lockfile-grade evidence', async () => {
    const repo = await makeRepository(undefined, await campaignFiles());
    const result = await new AstGrepAdapter({
      packs: [join(workspaceRoot, 'rulepacks/nextjs')],
      now: () => '2026-08-17T12:00:00.000Z',
    }).scan({ revision: repo.revision, framework: 'nextjs' });
    const diagnostics = diagnosticsOf(result.events);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: ARXIC_RULES_FRAMEWORK_ACCEPTED,
        severity: 'observed',
        subject: 'framework:nextjs',
        message: expect.stringContaining('16.2.6'),
      }),
    );
    expect(
      diagnostics.find((diagnostic) => diagnostic.code === ARXIC_RULES_FRAMEWORK_ACCEPTED)?.message,
    ).toContain('lockfile');
    expect(result.matches.length).toBeGreaterThan(0);
    const accepted = diagnostics.filter((diagnostic) => diagnostic.severity === 'blocked');
    expect(accepted).toEqual([]);
    for (const event of result.events)
      expect(
        'ref' in event ? validateEvidenceRef(event.ref) : validateDiagnostic(event.diagnostic),
      ).toMatchObject({ ok: true });
    // lockfile evidence is anchored and hash-covered
    const refs = result.events.filter((event) => 'ref' in event) as Array<{
      ref: { path: string; ruleId?: string };
    }>;
    expect(
      refs.some(
        (event) => event.ref.path === 'pnpm-lock.yaml' && event.ref.ruleId?.includes('nextjs'),
      ),
    ).toBe(true);
  });

  it('cell 2 — declared-range rejection: the campaign scenario (next 16.2.6 vs pack >=15 <16) blocks with explicit diagnostics and no rule matches', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'arxic-fw-campaign-'));
    const pack = await campaignPack(parent);
    const repo = await makeRepository(undefined, await campaignFiles());
    const result = await new AstGrepAdapter({
      packs: [pack],
      now: () => '2026-08-17T12:00:00.000Z',
    }).scan({ revision: repo.revision, framework: 'nextjs' });
    const diagnostics = diagnosticsOf(result.events);
    const rejected = diagnostics.find(
      (diagnostic) => diagnostic.code === ARXIC_RULES_FRAMEWORK_REJECTED,
    );
    expect(rejected).toMatchObject({
      severity: 'blocked',
      subject: 'framework:nextjs',
    });
    expect(rejected?.message).toContain('16.2.6');
    expect(rejected?.message).toContain('>=15 <16');
    expect(rejected?.message).toContain('nextjs-campaign');
    expect(JSON.stringify(diagnostics)).not.toContain(repo.root);
    expect(result.matches).toEqual([]);
    expect(result.chains).toEqual([]);
    // both evidence files are cited as anchored refs
    const paths = result.events
      .filter((event) => 'ref' in event)
      .map((event) => (event as { ref: { path: string } }).ref.path);
    expect(paths).toContain('package.json');
    expect(paths).toContain('pnpm-lock.yaml');
  });

  it('cell 2b — out-of-range against the shipped pack: next 17 is rejected by nextjs-auth >=15 <17', async () => {
    const repo = await makeRepository(undefined, {
      'package.json': JSON.stringify(
        { name: 'next-17-app', dependencies: { next: '17.0.0' } },
        undefined,
        2,
      ),
      'app/login/page.tsx':
        'export default async function LoginPage() {\n  return <main>login</main>;\n}\n',
    });
    const result = await new AstGrepAdapter({
      packs: [join(workspaceRoot, 'rulepacks/nextjs')],
    }).scan({ revision: repo.revision, framework: 'nextjs' });
    expect(
      diagnosticsOf(result.events).some(
        (diagnostic) =>
          diagnostic.code === ARXIC_RULES_FRAMEWORK_REJECTED && diagnostic.severity === 'blocked',
      ),
    ).toBe(true);
    expect(result.matches).toEqual([]);
  });

  it('cell 3 — unknown framework: laravel has no rulepack, so selection fails fast with a path-free diagnostic', async () => {
    const repo = await makeRepository(undefined, {
      'app/login/page.tsx':
        'export default async function LoginPage() {\n  return <main>login</main>;\n}\n',
    });
    const result = await new AstGrepAdapter({ packs: packDirs }).scan({
      revision: repo.revision,
      framework: 'laravel',
    });
    const diagnostics = diagnosticsOf(result.events);
    const unknown = diagnostics.find(
      (diagnostic) => diagnostic.code === ARXIC_RULES_FRAMEWORK_UNKNOWN,
    );
    expect(unknown).toMatchObject({ severity: 'blocked', subject: 'framework:laravel' });
    expect(unknown?.message).toContain('nextjs');
    expect(unknown?.message).toContain('express');
    expect(JSON.stringify(diagnostics)).not.toContain(workspaceRoot);
    expect(result.matches).toEqual([]);
  });

  it('cell 3b — unknown framework via a missing pack directory does not leak install paths (the campaign ENOENT defect)', async () => {
    const repo = await makeRepository(undefined, {
      'app/login/page.tsx':
        'export default async function LoginPage() {\n  return <main>login</main>;\n}\n',
    });
    const result = await new AstGrepAdapter({
      packs: [join(workspaceRoot, 'rulepacks/laravel')],
    }).scan({ revision: repo.revision, framework: 'laravel' });
    const diagnostics = diagnosticsOf(result.events);
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.code === ARXIC_RULES_FRAMEWORK_UNKNOWN &&
          diagnostic.subject === 'framework:laravel',
      ),
    ).toBe(true);
    expect(JSON.stringify(diagnostics)).not.toContain(join(workspaceRoot, 'rulepacks'));
    expect(result.matches).toEqual([]);
  });

  it('cell 4 — recorded waiver: a committed arxic.waivers.json unblocks the campaign rejection with operator provenance', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'arxic-fw-waiver-'));
    const pack = await campaignPack(parent);
    const waiver = {
      version: 1,
      frameworkWaivers: [
        {
          framework: 'nextjs',
          version: '16.2.6',
          packVersionRange: '>=15 <16',
          reason: 'operator reviewed nextjs-auth rules against Next 16.2.6 on 2026-08-16',
          approvedBy: 'anthonykewl20',
          recordedAt: '2026-08-17T00:00:00.000Z',
        },
      ],
    };
    const repo = await makeRepository(
      undefined,
      await campaignFiles({ 'arxic.waivers.json': JSON.stringify(waiver, undefined, 2) }),
    );
    const result = await new AstGrepAdapter({
      packs: [pack],
      now: () => '2026-08-17T12:00:00.000Z',
    }).scan({ revision: repo.revision, framework: 'nextjs' });
    const diagnostics = diagnosticsOf(result.events);
    const waived = diagnostics.find(
      (diagnostic) => diagnostic.code === ARXIC_RULES_FRAMEWORK_WAIVED,
    );
    expect(waived).toMatchObject({ severity: 'observed', subject: 'framework:nextjs' });
    expect(waived?.message).toContain('anthonykewl20');
    expect(waived?.message).toContain('16.2.6');
    expect(diagnostics.some((diagnostic) => diagnostic.severity === 'blocked')).toBe(false);
    expect(result.matches.length).toBeGreaterThan(0);
    // the waiver is evidence, not prose: the committed file is cited with line anchors
    const paths = result.events
      .filter((event) => 'ref' in event)
      .map((event) => (event as { ref: { path: string } }).ref.path);
    expect(paths).toContain('arxic.waivers.json');
  });

  it('waiver abuse: a waiver for a different version does not apply', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'arxic-fw-abuse1-'));
    const pack = await campaignPack(parent);
    const waiver = {
      version: 1,
      frameworkWaivers: [
        {
          framework: 'nextjs',
          version: '15.9.0',
          packVersionRange: '>=15 <16',
          reason: 'waiver recorded for a different Next build',
          approvedBy: 'anthonykewl20',
          recordedAt: '2026-08-17T00:00:00.000Z',
        },
      ],
    };
    const repo = await makeRepository(
      undefined,
      await campaignFiles({ 'arxic.waivers.json': JSON.stringify(waiver, undefined, 2) }),
    );
    const result = await new AstGrepAdapter({ packs: [pack] }).scan({
      revision: repo.revision,
      framework: 'nextjs',
    });
    const diagnostics = diagnosticsOf(result.events);
    expect(
      diagnostics.some((diagnostic) => diagnostic.code === ARXIC_RULES_FRAMEWORK_REJECTED),
    ).toBe(true);
    expect(diagnostics.some((diagnostic) => diagnostic.code === ARXIC_RULES_FRAMEWORK_WAIVED)).toBe(
      false,
    );
    expect(result.matches).toEqual([]);
  });

  it('waiver abuse: a waiver recorded against a different pack range does not apply after the pack changes', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'arxic-fw-abuse2-'));
    const pack = await campaignPack(parent);
    const waiver = {
      version: 1,
      frameworkWaivers: [
        {
          framework: 'nextjs',
          version: '16.2.6',
          packVersionRange: '>=16 <17',
          reason: 'stale waiver recorded against an older range',
          approvedBy: 'anthonykewl20',
          recordedAt: '2026-08-17T00:00:00.000Z',
        },
      ],
    };
    const repo = await makeRepository(
      undefined,
      await campaignFiles({ 'arxic.waivers.json': JSON.stringify(waiver, undefined, 2) }),
    );
    const result = await new AstGrepAdapter({ packs: [pack] }).scan({
      revision: repo.revision,
      framework: 'nextjs',
    });
    const diagnostics = diagnosticsOf(result.events);
    expect(
      diagnostics.some((diagnostic) => diagnostic.code === ARXIC_RULES_FRAMEWORK_REJECTED),
    ).toBe(true);
    expect(diagnostics.some((diagnostic) => diagnostic.code === ARXIC_RULES_FRAMEWORK_WAIVED)).toBe(
      false,
    );
  });

  it('PR #272 P2 — shipped-pack coherence: a range change carries a semver bump so voided waivers are visible', async () => {
    // `framework.versions` is normative and waivers bind to the exact current
    // range, so a range change voids recorded waivers; the pack version bump
    // is the operator-visible signal of that boundary (widening = minor,
    // narrowing = major). Pin the shipped pair — change either side without
    // the other and this fails red.
    const manifest = JSON.parse(
      await readFile(join(workspaceRoot, 'rulepacks/nextjs/pack.json'), 'utf8'),
    ) as { version: string; framework: Record<string, unknown> };
    expect(manifest.version).toBe('0.2.0');
    expect(manifest.framework).toEqual({ name: 'nextjs', versions: '>=15 <17' });
    const readme = await readFile(join(workspaceRoot, 'rulepacks/nextjs/README.md'), 'utf8');
    expect(readme).toContain('nextjs-auth@0.2.0');
  });

  it('PR #272 P2 — stale-range waiver voided by the pack change: a waiver recorded against >=15 <16 (pack 0.1.0) does not waive next 17 against the shipped pack', async () => {
    // The widening >=15 <16 → >=15 <17 (0.1.0 → 0.2.0) voids waivers recorded
    // against the old range: a waiver applies only when its packVersionRange
    // equals the pack's CURRENT declared range.
    const repo = await makeRepository(undefined, next17WaiverFiles('>=15 <16'));
    const result = await new AstGrepAdapter({
      packs: [join(workspaceRoot, 'rulepacks/nextjs')],
      now: () => '2026-08-17T12:00:00.000Z',
    }).scan({ revision: repo.revision, framework: 'nextjs' });
    const diagnostics = diagnosticsOf(result.events);
    const rejected = diagnostics.find(
      (diagnostic) => diagnostic.code === ARXIC_RULES_FRAMEWORK_REJECTED,
    );
    expect(rejected).toMatchObject({ severity: 'blocked', subject: 'framework:nextjs' });
    expect(rejected?.message).toContain('nextjs-auth@0.2.0');
    expect(rejected?.message).toContain('>=15 <17');
    expect(diagnostics.some((diagnostic) => diagnostic.code === ARXIC_RULES_FRAMEWORK_WAIVED)).toBe(
      false,
    );
    expect(result.matches).toEqual([]);
  });

  it('PR #272 P2 — only a waiver re-recorded against the current range+version applies', async () => {
    const repo = await makeRepository(undefined, next17WaiverFiles('>=15 <17'));
    const result = await new AstGrepAdapter({
      packs: [join(workspaceRoot, 'rulepacks/nextjs')],
      now: () => '2026-08-17T12:00:00.000Z',
    }).scan({ revision: repo.revision, framework: 'nextjs' });
    const diagnostics = diagnosticsOf(result.events);
    const waived = diagnostics.find(
      (diagnostic) => diagnostic.code === ARXIC_RULES_FRAMEWORK_WAIVED,
    );
    expect(waived).toMatchObject({ severity: 'observed', subject: 'framework:nextjs' });
    expect(waived?.message).toContain('anthonykewl20');
    // the pack version that voided the old waiver is named in the diagnostic
    expect(waived?.message).toContain('nextjs-auth@0.2.0');
    expect(diagnostics.some((diagnostic) => diagnostic.severity === 'blocked')).toBe(false);
    expect(result.matches.length).toBeGreaterThan(0);
  });

  it('waiver tampering: a malformed waivers file fails closed as blocked even when a scan would otherwise be accepted', async () => {
    const repo = await makeRepository(undefined, {
      'package.json': JSON.stringify(
        { name: 'in-range-app', dependencies: { next: '15.4.1' } },
        undefined,
        2,
      ),
      'app/login/page.tsx':
        'export default async function LoginPage() {\n  return <main>login</main>;\n}\n',
      'arxic.waivers.json': '{ not json',
    });
    const result = await new AstGrepAdapter({
      packs: [join(workspaceRoot, 'rulepacks/nextjs')],
    }).scan({ revision: repo.revision, framework: 'nextjs' });
    const diagnostics = diagnosticsOf(result.events);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: ARXIC_RULES_WAIVER_INVALID,
        severity: 'blocked',
        subject: 'arxic.waivers.json',
      }),
    );
    expect(result.matches).toEqual([]);
  });

  it('lockfile outranks a contradicting manifest: an in-range package.json cannot mask an out-of-range lockfile', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'arxic-fw-precedence-'));
    const pack = await campaignPack(parent);
    const files = await campaignFiles();
    files['package.json'] = JSON.stringify(
      { name: 'lying-manifest', dependencies: { next: '15.4.1' } },
      undefined,
      2,
    );
    const repo = await makeRepository(undefined, files);
    const result = await new AstGrepAdapter({ packs: [pack] }).scan({
      revision: repo.revision,
      framework: 'nextjs',
    });
    expect(
      diagnosticsOf(result.events).some(
        (diagnostic) => diagnostic.code === ARXIC_RULES_FRAMEWORK_REJECTED,
      ),
    ).toBe(true);
    expect(result.matches).toEqual([]);
  });

  it('no version evidence: an explicit observed non-enforcement diagnostic, and the scan still runs (frozen-contract compatibility)', async () => {
    const repo = await makeRepository(undefined, {
      'src/server.ts': "app.post('/login', () => {});\n",
    });
    const result = await new AstGrepAdapter({ packs: packDirs }).scan({
      revision: repo.revision,
      framework: 'express',
    });
    const diagnostics = diagnosticsOf(result.events);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: ARXIC_RULES_FRAMEWORK_UNDETECTED,
        severity: 'observed',
        subject: 'framework:express',
      }),
    );
    expect(diagnostics.some((diagnostic) => diagnostic.severity === 'blocked')).toBe(false);
    expect(result.matches.length).toBeGreaterThan(0);
  });

  it('import-graph tier: framework presence without a manifest is detected from real imports at anchored lines', async () => {
    const repo = await makeRepository(undefined, {
      'src/probe.ts': "import { cookies } from 'next/headers';\nexport const x = cookies;\n",
    });
    const detection = await detectFrameworkEvidence({
      root: repo.root,
      repository: repo.revision.repository,
      commit: repo.revision.commit,
    });
    const nextjs = detection.frameworks.find((framework) => framework.name === 'nextjs');
    expect(nextjs).toMatchObject({ tier: 'imports' });
    expect(nextjs?.version).toBeUndefined();
    expect(nextjs?.evidence[0]).toMatchObject({ path: 'src/probe.ts', startLine: 1, endLine: 1 });
  });

  it('prerelease pins keep their prerelease through detection: next 16.0.0-rc.1 does not satisfy >=16', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'arxic-fw-prerelease-'));
    const pack = await writePack(parent, 'nextjs-rc', 'nextjs-page-route', false, {
      name: 'nextjs',
      versions: '>=16',
    });
    const repo = await makeRepository(undefined, {
      'package.json': JSON.stringify(
        { name: 'rc-app', dependencies: { next: '16.0.0-rc.1' } },
        undefined,
        2,
      ),
      'app/login/page.tsx':
        'export default async function LoginPage() {\n  return <main>login</main>;\n}\n',
    });
    const result = await new AstGrepAdapter({ packs: [pack] }).scan({
      revision: repo.revision,
      framework: 'nextjs',
    });
    const rejected = diagnosticsOf(result.events).find(
      (diagnostic) => diagnostic.code === ARXIC_RULES_FRAMEWORK_REJECTED,
    );
    expect(rejected?.message).toContain('16.0.0-rc.1');
    expect(result.matches).toEqual([]);
  });

  it('detection is deterministic across repeated runs', async () => {
    const repo = await makeRepository(undefined, await campaignFiles());
    const first = await detectFrameworkEvidence({
      root: repo.root,
      repository: repo.revision.repository,
      commit: repo.revision.commit,
    });
    const second = await detectFrameworkEvidence({
      root: repo.root,
      repository: repo.revision.repository,
      commit: repo.revision.commit,
    });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe('real third-party evidence: koel (Laravel 13) at the DG-05-pinned commit', () => {
  async function koelFiles(extra: Record<string, string> = {}): Promise<Record<string, string>> {
    return {
      'composer.json': await readFile(join(evidenceRoot, 'koel/composer.json'), 'utf8'),
      'composer.lock': await readFile(join(evidenceRoot, 'koel/composer.lock'), 'utf8'),
      ...extra,
    };
  }

  it('detects laravel v13.24.0 from the real composer.lock with lockfile-grade evidence', async () => {
    const repo = await makeRepository(undefined, await koelFiles());
    const detection = await detectFrameworkEvidence({
      root: repo.root,
      repository: repo.revision.repository,
      commit: repo.revision.commit,
    });
    const laravel = detection.frameworks.find((framework) => framework.name === 'laravel');
    expect(laravel).toMatchObject({ name: 'laravel', version: '13.24.0', tier: 'lockfile' });
    expect(laravel?.evidence[0]?.path).toBe('composer.lock');
  });

  it('a laravel pack declaring >=13 <14 accepts koel; the shipped packs list has no laravel pack (issue scenario)', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'arxic-fw-koel-'));
    const pack = await writePack(parent, 'laravel-auth', 'laravel-route', false, {
      name: 'laravel',
      versions: '>=13 <14',
    });
    const repo = await makeRepository(undefined, await koelFiles());
    const accepted = await new AstGrepAdapter({ packs: [pack] }).scan({
      revision: repo.revision,
      framework: 'laravel',
    });
    expect(
      diagnosticsOf(accepted.events).some(
        (diagnostic) =>
          diagnostic.code === ARXIC_RULES_FRAMEWORK_ACCEPTED &&
          diagnostic.message.includes('13.24.0'),
      ),
    ).toBe(true);
    const unknown = await new AstGrepAdapter({ packs: packDirs }).scan({
      revision: repo.revision,
      framework: 'laravel',
    });
    expect(
      diagnosticsOf(unknown.events).some(
        (diagnostic) => diagnostic.code === ARXIC_RULES_FRAMEWORK_UNKNOWN,
      ),
    ).toBe(true);
    expect(unknown.matches).toEqual([]);
  });
});
