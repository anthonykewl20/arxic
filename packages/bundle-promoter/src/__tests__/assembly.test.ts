import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateDiagnostic } from '@arxic/contracts';
import type { ArtifactRef, StagedBundle } from '@arxic/contracts';
import { describe, expect, it } from 'vitest';
import { ARXIC_PROMOTION_REDACTION_FAILED, assembleBundle, scanBundleForSensitiveData } from '..';
import { stagedBundle } from './bundle-fixture';

describe('bundle assembly and redaction gate', () => {
  it('blocks real email addresses in text artifacts', async () => {
    const directory = await textBundle('account=user@real-company.com');
    const result = await scanBundleForSensitiveData(directory);
    expect(result).toMatchObject({
      passed: false,
      findings: [{ file: 'artifact.txt', pattern: 'email-address' }],
      diagnostics: [{ code: ARXIC_PROMOTION_REDACTION_FAILED, severity: 'blocked' }],
    });
  });

  it('allows the test-sink email domain', async () => {
    const result = await scanBundleForSensitiveData(await textBundle('account=user@example.test'));
    expect(result).toMatchObject({ passed: true, findings: [], diagnostics: [] });
  });

  it('allows environment variable references', async () => {
    const directory = await textBundle(
      'password = process.env["ARXIC_INPUT_PERSONA_EMAIL"]\napiKey = ARXIC_INPUT_API_KEY',
    );
    expect(await scanBundleForSensitiveData(directory)).toMatchObject({ passed: true });
  });

  it('blocks bearer authorization tokens', async () => {
    const directory = await textBundle(
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.authentication-payload',
    );
    const result = await scanBundleForSensitiveData(directory);
    expect(result.passed).toBe(false);
    expect(result.findings.map(({ pattern }) => pattern)).toEqual(
      expect.arrayContaining(['authorization-header', 'bearer-token']),
    );
  });

  it('writes matching checksums for every listed file', async () => {
    const assembly = await assemblyFixture();
    const lines = assembly.checksumsSha256.trimEnd().split('\n');
    for (const line of lines) {
      const [expected, path] = line.split('  ');
      const actual = createHash('sha256')
        .update(await readFile(join(assembly.directory, path!)))
        .digest('hex');
      expect(actual, path).toBe(expected);
    }
    expect(lines.some((line) => line.endsWith('  checksums.sha256'))).toBe(false);
    expect(assembly.files.map(({ path }) => path)).toContain('checksums.sha256');
  });

  it('refuses to erase an output path containing the staged directory', async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-parent-'));
    const stagedDirectory = join(outputDirectory, 'staged');
    await mkdir(stagedDirectory);
    await expect(
      assembleBundle({
        bundle: await stagedBundle(),
        stagedDirectory,
        outputDirectory,
        provenance: {
          repository: 'https://github.com/anthonykewl20/arxic',
          commit: '0123456789abcdef0123456789abcdef01234567',
          appBuildDigest: 'a'.repeat(64),
        },
      }),
    ).rejects.toThrow('must not contain the staged directory');
    await expect(stat(stagedDirectory)).resolves.toBeDefined();
  });

  it('creates the complete ADR section 14 layout', async () => {
    const assembly = await assemblyFixture();
    for (const path of [
      'manifest.json',
      'workflow.json',
      'plan.md',
      'tests/workflow.spec.ts',
      'fixtures/workflow.fixture.ts',
      'playwright.config.ts',
      'evidence/index.json',
      'artifacts/screenshots',
      'artifacts/traces',
      'provenance.json',
      'NOTICE',
      'checksums.sha256',
    ]) {
      await expect(stat(join(assembly.directory, path)), path).resolves.toBeDefined();
    }
  });

  it('loop-closes the redaction diagnostic through the frozen validator', () => {
    expect(
      validateDiagnostic({
        code: ARXIC_PROMOTION_REDACTION_FAILED,
        severity: 'blocked',
        subject: 'artifact.txt',
        message: 'Sensitive content was blocked',
      }),
    ).toMatchObject({ ok: true });
  });
});

async function textBundle(content: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-redaction-'));
  await writeFile(join(directory, 'artifact.txt'), content, 'utf8');
  await writeFile(join(directory, 'ignored.png'), content);
  return directory;
}

async function assemblyFixture() {
  const stagedDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-staged-'));
  const outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-output-'));
  const files = [
    [
      'tests/workflow.spec.ts',
      "import { test } from '@playwright/test';\ntest('workflow', async () => {});\n",
    ],
    ['fixtures/workflow.fixture.ts', 'export const fixture = true;\n'],
    ['playwright.config.ts', 'export default { workers: 1 };\n'],
  ] as const;
  const artifacts: ArtifactRef[] = [];
  for (const [path, content] of files) {
    await mkdir(join(stagedDirectory, path, '..'), { recursive: true });
    await writeFile(join(stagedDirectory, path), content, 'utf8');
    artifacts.push({ kind: path, path, sha256: hash(content) });
  }
  const base = await stagedBundle();
  const bundle: StagedBundle = { ...base, artifacts };
  return assembleBundle({
    bundle,
    stagedDirectory,
    outputDirectory,
    provenance: {
      repository: bundle.manifest.repository,
      commit: bundle.manifest.commit,
      appBuildDigest: bundle.manifest.appBuildDigest,
    },
    now: () => '2026-08-06T12:00:00.000Z',
  });
}

function hash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
