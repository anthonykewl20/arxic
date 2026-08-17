import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type {
  Diagnostic,
  EvidenceEvent,
  EvidenceRefSource,
  SourceRevision,
} from '@arxic/contracts';
import {
  canonicalJson as serializeCanonicalJson,
  sha256,
  validateDiagnostic,
  validateEvidenceRef,
} from '@arxic/contracts';
import { readSafeSource } from '@arxic/fs-safe';
import { ARXIC_RULES_DIRTY_TREE, ARXIC_RULES_FALLBACK, rulesDiagnostic } from './diagnostics';
import { committedRevision, sourceFiles } from './git';
import {
  detectFrameworkEvidence,
  evaluateFrameworkGate,
  frameworkGateEvidence,
  type DetectedFramework,
} from './framework-gate';
import { interpretMatches, type EvidencedRuleMatch, type FeatureChain } from './interpret';
import { loadPacks, type LoadedPack } from './packs';
import { codepointCompare, runRules, type RuleMatch } from './runner';

export * from './diagnostics';
export * from './framework-gate';
export * from './git';
export * from './interpret';
export * from './packs';
export * from './runner';
export const PACKAGE_NAME = '@arxic/ast-grep-adapter' as const;
const ARXIC_RULES_UNSAFE_SOURCE = 'ARXIC-RULES-UNSAFE-SOURCE' as const;
const ARXIC_RULES_SOURCE_OVERSIZE = 'ARXIC-RULES-SOURCE-OVERSIZE' as const;

export type AstGrepAdapterOptions = {
  packs: string[];
  sgBinary?: string;
  now?: () => string;
  maxFileSizeBytes?: number;
};
export type AstGrepScanInput = {
  revision: SourceRevision;
  features?: string[];
  framework?: string;
};
export type AstGrepScanResult = {
  events: EvidenceEvent[];
  matches: EvidencedRuleMatch[];
  chains: FeatureChain[];
  packs: LoadedPack[];
  generatedAt: string;
  /** DG-10: deterministic framework detection over the scanned revision
   * (empty when no framework was requested). Optional so consumers that
   * construct result literals — the evidence graph, checkpoint rehydration —
   * keep compiling without knowing the field. */
  frameworks?: DetectedFramework[];
};

export class AstGrepAdapter {
  private readonly options: AstGrepAdapterOptions;
  constructor(options: AstGrepAdapterOptions) {
    this.options = options;
  }
  async *index(input: AstGrepScanInput): AsyncIterable<EvidenceEvent> {
    yield* (await this.scan(input)).events;
  }
  async scan(input: AstGrepScanInput): Promise<AstGrepScanResult> {
    const events: EvidenceEvent[] = [];
    const requestedRoot = input.revision.repository.startsWith('file:')
      ? fileURLToPath(input.revision.repository)
      : input.revision.repository;
    const root = await realpath(requestedRoot);
    const packs = await loadPacks(this.options.packs);
    events.push(...packs.diagnostics.map((diagnostic) => eventDiagnostic(diagnostic)));
    const provenance = await committedRevision(root);
    if (
      !provenance.commit ||
      provenance.dirty ||
      provenance.commit !== input.revision.commit ||
      input.revision.dirty
    ) {
      events.push(
        eventDiagnostic(
          rulesDiagnostic(
            ARXIC_RULES_DIRTY_TREE,
            root,
            'A clean committed revision matching the request is required; zero source refs emitted',
          ),
        ),
      );
      return {
        events,
        matches: [],
        chains: [],
        packs: packs.packs,
        frameworks: [],
        generatedAt: this.now(),
      };
    }
    const files = await sourceFiles(root);
    const safeFiles = new Map<string, Buffer>();
    const maxFileSizeBytes = this.options.maxFileSizeBytes ?? 1024 * 1024;
    for (const path of files) {
      const read = await readSafeSource(root, path, maxFileSizeBytes);
      if (read.ok) safeFiles.set(path, read.bytes);
      else
        events.push(
          eventDiagnostic({
            code:
              read.kind === 'oversize' ? ARXIC_RULES_SOURCE_OVERSIZE : ARXIC_RULES_UNSAFE_SOURCE,
            severity: 'blocked',
            subject: path,
            message: read.detail,
          }),
        );
    }
    // DG-10 (ADR-008 Decision 9): normative framework gating at rulepack
    // selection time. Runs only when a framework is requested — the config
    // surface always supplies one; framework-less scans keep legacy behavior.
    let frameworks: DetectedFramework[] = [];
    if (input.framework) {
      const detection = await detectFrameworkEvidence({
        root,
        repository: input.revision.repository,
        commit: provenance.commit,
        sourceBytes: safeFiles,
      });
      frameworks = detection.frameworks;
      const gate = evaluateFrameworkGate({
        frameworks: [input.framework],
        packs: packs.packs,
        detection,
      });
      events.push(...gate.diagnostics.map((diagnostic) => eventDiagnostic(diagnostic)));
      for (const ref of frameworkGateEvidence({
        frameworks: [input.framework],
        detection,
        verdicts: gate.verdicts,
      }))
        events.push({ ref });
      if (!gate.runRules) {
        events.sort((left, right) => codepointCompare(JSON.stringify(left), JSON.stringify(right)));
        return {
          events,
          matches: [],
          chains: [],
          packs: packs.packs,
          frameworks,
          generatedAt: this.now(),
        };
      }
    }
    const selectedPackIds = input.framework
      ? new Set(
          packs.packs
            .filter((pack) => pack.framework.name === input.framework)
            .map((pack) => pack.id),
        )
      : undefined;
    const scanRoot = await mkdtemp(join(tmpdir(), 'arxic-sg-safe-'));
    let runner: Awaited<ReturnType<typeof runRules>>;
    try {
      for (const [path, bytes] of safeFiles) {
        const destination = join(scanRoot, ...path.split('/'));
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, bytes, { flag: 'wx' });
      }
      runner = await runRules({
        binary: this.options.sgBinary,
        cwd: scanRoot,
        rules: selectedPackIds
          ? packs.rules.filter((rule) => selectedPackIds.has(rule.packId))
          : packs.rules,
        paths: [...safeFiles.keys()],
      });
    } finally {
      await rm(scanRoot, { recursive: true, force: true });
    }
    events.push(...runner.diagnostics.map((diagnostic) => eventDiagnostic(diagnostic)));
    const matches: EvidencedRuleMatch[] = [];
    if (runner.diagnostics.length === 0) {
      for (const match of runner.matches) {
        const bytes = safeFiles.get(match.file);
        if (!bytes) continue;
        const evidence: EvidenceRefSource = {
          kind: 'source',
          repo: pathToFileURL(root).href,
          commit: provenance.commit,
          path: match.file,
          startLine: match.startLine,
          endLine: match.endLine,
          blobSha256: sha256(bytes),
          extractor: PACKAGE_NAME,
          ruleId: `${match.packId}/${match.ruleId}@${match.ruleVersion}`,
        };
        if (!validateEvidenceRef(evidence).ok)
          throw new Error('adapter manufactured invalid EvidenceRef');
        matches.push({ ...match, evidence });
        events.push({ ref: evidence });
      }
    }
    for (const [path, bytes] of safeFiles) {
      const text = bytes.toString('utf8');
      if (/@(?:Get|Post|Put|Patch|Delete)\s*\(\s*['"][^'"]+['"]\s*\)/u.test(text))
        events.push(
          eventDiagnostic(
            rulesDiagnostic(
              ARXIC_RULES_FALLBACK,
              path,
              'regex-fallback detected decorator route syntax; this is never primary evidence',
            ),
          ),
        );
    }
    const interpreted = interpretMatches(matches, input.features);
    events.push(...interpreted.diagnostics.map((diagnostic) => eventDiagnostic(diagnostic)));
    events.sort((left, right) => codepointCompare(JSON.stringify(left), JSON.stringify(right)));
    return {
      events,
      matches,
      chains: interpreted.chains,
      packs: packs.packs,
      frameworks,
      generatedAt: this.now(),
    };
  }
  private now() {
    return (this.options.now ?? (() => new Date().toISOString()))();
  }
}

function eventDiagnostic(diagnostic: Diagnostic): EvidenceEvent {
  if (!validateDiagnostic(diagnostic).ok)
    throw new Error('adapter manufactured invalid Diagnostic');
  return { diagnostic };
}

export function diagnosticsOf(events: EvidenceEvent[]): Diagnostic[] {
  return events.flatMap((event) => ('diagnostic' in event ? [event.diagnostic] : []));
}
export function sourceRefsOf(events: EvidenceEvent[]): EvidenceRefSource[] {
  return events.flatMap((event) =>
    'ref' in event && event.ref.kind === 'source' ? [event.ref] : [],
  );
}
const serializeAstGrepResult = (value: unknown): string =>
  serializeCanonicalJson(value, { mode: 'legacy' });
export { serializeAstGrepResult as canonicalJson };
export type { RuleMatch };
