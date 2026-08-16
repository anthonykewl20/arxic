import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Diagnostic } from '@arxic/contracts';
import {
  ARXIC_RULES_FRAMEWORK_UNDETECTED,
  committedRevision,
  detectFrameworkEvidence,
  evaluateFrameworkGate,
  loadPacks,
  type FrameworkDetection,
} from '@arxic/ast-grep-adapter';

const EMPTY_DETECTION: FrameworkDetection = { frameworks: [], waivers: [], waiverDiagnostics: [] };

/**
 * DG-10 fail-fast framework gate (ADR-008 Decision 9, #254).
 *
 * Action layer: decides WHEN framework evidence must block a run — before any
 * crawl — using the adapter's Service-layer detection and enforcement. The
 * mechanics (lockfile/manifest/import tiers, range math, waiver semantics)
 * live in `@arxic/ast-grep-adapter` and are the same code the pipeline's
 * stage-3 scan runs, so the gate can never be stricter or looser than the
 * enforcement that follows.
 *
 * Returns `undefined` when the rulepacks root is absent — legacy executor
 * environments (unit-tested fakes, worker images) — because stage 3 reports
 * missing packs itself. A dirty or non-git source tree skips version
 * enforcement at the gate (there is no honest commit to attribute evidence
 * to); stage 3 re-detects against the required clean revision.
 */
export async function frameworkGateDiagnostics(input: {
  rulepacksDir: string;
  frameworks: readonly string[];
  repositoryRoot: string;
}): Promise<Diagnostic[] | undefined> {
  if (!(await pathExists(input.rulepacksDir))) return undefined;
  const directories: string[] = [];
  for (const entry of await readdir(input.rulepacksDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    // Placeholder directories without pack.json are not installed packs.
    const manifest = join(input.rulepacksDir, entry.name, 'pack.json');
    if (await pathExists(manifest)) directories.push(join(input.rulepacksDir, entry.name));
  }
  directories.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const packs = await loadPacks(directories);
  let detection = EMPTY_DETECTION;
  const provenance = await committedRevision(input.repositoryRoot).catch(() => ({
    commit: null,
    dirty: true,
  }));
  if (provenance.commit && !provenance.dirty) {
    detection = await detectFrameworkEvidence({
      root: input.repositoryRoot,
      repository: pathToFileURL(input.repositoryRoot).href,
      commit: provenance.commit,
    });
  }
  const gate = evaluateFrameworkGate({
    frameworks: input.frameworks,
    packs: packs.packs,
    detection,
  });
  return [...packs.diagnostics, ...gate.diagnostics].filter(
    (diagnostic) => diagnostic.code !== ARXIC_RULES_FRAMEWORK_UNDETECTED,
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
