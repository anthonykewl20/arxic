import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const reconcilerRoot = resolve(import.meta.dirname, '../..');

describe('reconciler graph service seam', () => {
  it('consumes the evidence-graph topology capability rather than graphology directly', async () => {
    const [manifest, reconciliation] = await Promise.all([
      readFile(resolve(reconcilerRoot, 'package.json'), 'utf8'),
      readFile(resolve(reconcilerRoot, 'src/reconcile.ts'), 'utf8'),
    ]);

    expect(JSON.parse(manifest).dependencies.graphology).toBeUndefined();
    expect(reconciliation).toMatch(
      /import\s*\{[\s\S]*?\bbuildDirectedGraph\b[\s\S]*?\}\s*from '@arxic\/evidence-graph';/u,
    );
    expect(reconciliation).not.toContain("from 'graphology'");
  });
});
