import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, realpath, rm, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type {
  Diagnostic,
  EvidenceEvent,
  EvidenceRefSource,
  SourceRevision,
} from '@arxic/contracts';
import { validateDiagnostic, validateEvidenceRef } from '@arxic/contracts';
import { ARXIC_RULES_DIRTY_TREE, ARXIC_RULES_FALLBACK, rulesDiagnostic } from './diagnostics';
import { committedRevision, sourceFiles } from './git';
import { interpretMatches, type EvidencedRuleMatch, type FeatureChain } from './interpret';
import { loadPacks, type LoadedPack } from './packs';
import { codepointCompare, runRules, type RuleMatch } from './runner';

export * from './diagnostics';
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
      return { events, matches: [], chains: [], packs: packs.packs, generatedAt: this.now() };
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
          blobSha256: createHash('sha256').update(bytes).digest('hex'),
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
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => codepointCompare(a, b))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  return value;
}
export type { RuleMatch };

type SafeRead =
  { ok: true; bytes: Buffer } | { ok: false; kind: 'oversize' | 'unsafe'; detail: string };

function isContained(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

async function readSafeSource(root: string, path: string, maxBytes: number): Promise<SafeRead> {
  const candidate = resolve(root, path);
  if (!isContained(root, candidate))
    return { ok: false, kind: 'unsafe', detail: 'Path escapes resolved source root.' };
  let before: Awaited<ReturnType<typeof lstat>>;
  try {
    before = await lstat(candidate);
  } catch (error) {
    return { ok: false, kind: 'unsafe', detail: String(error) };
  }
  if (before.isSymbolicLink()) {
    let detail = 'Symbolic links are not source files.';
    try {
      const target = await realpath(candidate);
      if (!isContained(root, target))
        detail = `Symbolic-link target escapes resolved source root: ${target}`;
    } catch (error) {
      detail = `Symbolic link cannot be resolved safely: ${String(error)}`;
    }
    return { ok: false, kind: 'unsafe', detail };
  }
  if (!before.isFile())
    return { ok: false, kind: 'unsafe', detail: 'Only regular files may be collected.' };
  let resolvedFile: string;
  try {
    resolvedFile = await realpath(candidate);
  } catch (error) {
    return { ok: false, kind: 'unsafe', detail: String(error) };
  }
  if (!isContained(root, resolvedFile))
    return { ok: false, kind: 'unsafe', detail: 'Real path escapes resolved source root.' };
  if (before.size > maxBytes)
    return {
      ok: false,
      kind: 'oversize',
      detail: `${before.size} bytes exceeds quota ${maxBytes}.`,
    };

  let handle: FileHandle | undefined;
  try {
    handle = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
    const after = await handle.stat();
    const reopenedPath = await realpath(candidate);
    let descriptorPath = reopenedPath;
    if (process.platform === 'linux') descriptorPath = await realpath(`/proc/self/fd/${handle.fd}`);
    else if (process.platform === 'darwin') descriptorPath = await realpath(`/dev/fd/${handle.fd}`);
    if (
      !after.isFile() ||
      !isContained(root, descriptorPath) ||
      !isContained(root, reopenedPath) ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.nlink > 1
    )
      return {
        ok: false,
        kind: 'unsafe',
        detail: 'Opened source descriptor is not the contained regular file that was inspected.',
      };
    if (after.size > maxBytes)
      return {
        ok: false,
        kind: 'oversize',
        detail: `${after.size} bytes exceeds quota ${maxBytes}.`,
      };
    const bytes = Buffer.allocUnsafe(after.size);
    let offset = 0;
    while (offset < after.size) {
      const length = Math.min(64 * 1024, after.size - offset);
      const { bytesRead } = await handle.read(bytes, offset, length, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset !== after.size)
      return { ok: false, kind: 'unsafe', detail: 'Source changed while reading.' };
    return { ok: true, bytes };
  } catch (error) {
    return { ok: false, kind: 'unsafe', detail: String(error) };
  } finally {
    await handle?.close();
  }
}
