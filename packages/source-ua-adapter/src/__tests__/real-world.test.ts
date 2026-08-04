import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateDiagnostic, validateEvidenceRef } from '@arxic/contracts';
import { describe, expect, it } from 'vitest';
import { canonicalJson, SourceUaAdapter } from '..';
import { makeRepository } from './test-repo';

function preTimestamp(document: Awaited<ReturnType<SourceUaAdapter['collect']>>) {
  const stable: Partial<typeof document> = { ...document };
  delete stable.generatedAt;
  return canonicalJson(stable);
}

function assertContractEvents(document: Awaited<ReturnType<SourceUaAdapter['collect']>>) {
  for (const event of document.events) {
    if ('ref' in event) expect(validateEvidenceRef(event.ref)).toMatchObject({ ok: true });
    else expect(validateDiagnostic(event.diagnostic)).toMatchObject({ ok: true });
  }
}

describe('real-world deterministic extraction', () => {
  it('indexes the real Next.js reference app with manifest, structures, calls, imports, and routes', async () => {
    const repo = await makeRepository('reference-auth-app');
    const adapter = new SourceUaAdapter();
    const first = await adapter.collect(repo.request);
    const second = await adapter.collect(repo.request);
    expect(first.revision.commit).toMatch(/^[0-9a-f]{40}$/u);
    const login = first.manifest.find((file) => file.path === 'app/login/page.tsx');
    const bytes = await readFile(join(repo.root, 'app/login/page.tsx'));
    expect(login?.blobSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    const refs = first.events.flatMap((event) =>
      'ref' in event && event.ref.kind === 'source' ? [event.ref] : [],
    );
    expect(refs.some((ref) => ref.ruleId === 'route:GET /login')).toBe(true);
    expect(refs.some((ref) => ref.ruleId?.startsWith('symbol:'))).toBe(true);
    expect(refs.some((ref) => ref.ruleId?.startsWith('import:'))).toBe(true);
    expect(refs.some((ref) => ref.ruleId?.startsWith('call:'))).toBe(true);
    for (const ref of refs) {
      expect(ref.startLine).toBeLessThanOrEqual(ref.endLine);
      expect(first.manifest.some((file) => file.path === ref.path)).toBe(true);
    }
    expect(preTimestamp(first)).toBe(preTimestamp(second));
    assertContractEvents(first);
  });

  it('indexes the real vulnerable Express app and extracts login, logout, and reset routes', async () => {
    const repo = await makeRepository('vulnerable-auth-app');
    const adapter = new SourceUaAdapter();
    const first = await adapter.collect(repo.request);
    const second = await adapter.collect(repo.request);
    const routeIds = first.events.flatMap((event) =>
      'ref' in event && event.ref.kind === 'source' && event.ref.ruleId?.startsWith('route:')
        ? [event.ref.ruleId]
        : [],
    );
    expect(routeIds).toEqual(
      expect.arrayContaining(['route:POST /login', 'route:POST /logout', 'route:POST /reset']),
    );
    expect(preTimestamp(first)).toBe(preTimestamp(second));
    assertContractEvents(first);
  });
});
