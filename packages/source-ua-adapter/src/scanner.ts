import { createRequire } from 'node:module';
import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { EvidenceEvent, EvidenceRefSource, SourceIndexRequest } from '@arxic/contracts';
import { dirtyPaths, enumerateFiles, isShallowRepository, resolveCommit } from './git';
import { sha256 } from '@arxic/contracts';
import { detectCategory, detectLanguage, isBinary, type ManifestFile } from './manifest';
import { GrammarUnavailableError, SourceParser, type ParsedSource } from './parser';
import { extractTypeScript, type SourceFinding } from './extractors/typescript';
import { extractFrameworkRoutes } from './framework-registry';
import { ARXIC_SOURCE_GRAMMAR_UNAVAILABLE } from './diagnostics';
import { isExtraIgnored, type SourceScanPolicy, type SupportedSourceLanguage } from './policy';
import {
  extractWithPack,
  languagePackFor,
  type CrossFileFinding,
  type RouteFindingPack,
} from './language-packs';
import {
  toRouteInventoryInterchange,
  type RouteInventoryInterchange,
} from './language-packs/interchange';
import type { LaravelGap, LaravelRouteRow } from './language-packs/php/laravel-routes';
import { ARXIC_SOURCE_UNSAFE_FILE, readSafeSource } from './safe-source';

const require = createRequire(import.meta.url);

export type ScanDocument = {
  revision: { repository: string; commit: string | null; dirty: boolean };
  manifest: ManifestFile[];
  events: EvidenceEvent[];
  toolVersions: Record<string, string>;
  /** Per-pack route inventories (interchange v1); absent when not requested. */
  inventories?: RouteInventoryInterchange[];
};

type PackInventoryAccumulator = {
  packId: string;
  language: string;
  framework?: string;
  routes: LaravelRouteRow[];
  gaps: LaravelGap[];
  files: Map<string, { path: string; sha256: string }>;
};

export async function scanRepository(
  input: SourceIndexRequest,
  policy: SourceScanPolicy,
): Promise<ScanDocument> {
  const events: EvidenceEvent[] = [];
  const manifest: ManifestFile[] = [];
  const versions = toolVersions();
  const packInventories = new Map<string, PackInventoryAccumulator>();
  const inventoryOf = (language: string): PackInventoryAccumulator | null => {
    const pack = languagePackFor(language);
    if (!pack) return null;
    let entry = packInventories.get(language);
    if (!entry) {
      const rule = pack.frameworkRules[0];
      entry = {
        packId: pack.inventoryPackId,
        language,
        ...(rule ? { framework: rule.framework } : {}),
        routes: [],
        gaps: [],
        files: new Map(),
      };
      packInventories.set(language, entry);
    }
    return entry;
  };
  const empty = (commit: string | null, dirty = false): ScanDocument => ({
    revision: { repository: input.revision.repository, commit, dirty },
    manifest,
    events,
    toolVersions: versions,
  });

  let root: string;
  try {
    const url = new URL(input.revision.repository);
    if (url.protocol !== 'file:')
      throw new Error('only file: repositories are supported by the local adapter');
    root = fileURLToPath(url);
  } catch (error) {
    events.push({
      diagnostic: policy.classifyFailure(
        'repository-unavailable',
        input.revision.repository,
        String(error),
      ),
    });
    return empty(null);
  }

  let resolvedRoot: string;
  try {
    resolvedRoot = await realpath(root);
  } catch (error) {
    events.push({
      diagnostic: policy.classifyFailure('repository-unavailable', root, String(error)),
    });
    return empty(null);
  }

  const commit = await resolveCommit(resolvedRoot);
  if (!commit) {
    events.push({
      diagnostic: policy.classifyFailure(
        'no-commit',
        '.',
        'Repository has no resolvable HEAD commit.',
      ),
    });
    return empty(null);
  }
  if (await isShallowRepository(resolvedRoot)) {
    events.push({
      diagnostic: policy.classifyFailure(
        'shallow',
        '.',
        'Shallow repositories are rejected because provenance history is incomplete.',
      ),
    });
    return empty(commit);
  }
  if (input.revision.commit !== commit) {
    events.push({
      diagnostic: policy.classifyFailure(
        'revision-mismatch',
        '.',
        `Requested ${input.revision.commit}; working tree HEAD is ${commit}.`,
      ),
    });
    return empty(commit);
  }

  const dirty = await dirtyPaths(resolvedRoot);
  const dirtySet = new Set(dirty);
  if (dirty.length > 0) {
    events.push({
      diagnostic: policy.classifyFailure('dirty', '.', `Uncommitted paths: ${dirty.join(', ')}`),
    });
  }

  const parser = new SourceParser();
  // Cross-file reads for framework packs (controller convention resolution),
  // memoized per scan so handler EvidenceRefs can reuse the blob sha256.
  const fileMemo = new Map<string, { text: string; blobSha256: string } | null>();
  const packAccess = {
    async readRelative(path: string) {
      if (fileMemo.has(path)) {
        const cached = fileMemo.get(path);
        return cached
          ? { ok: true as const, text: cached.text }
          : { ok: false as const, reason: 'unreadable' };
      }
      const safeRead = await readSafeSource(resolvedRoot, path, policy.maxFileSizeBytes);
      if (!safeRead.ok) {
        fileMemo.set(path, null);
        return { ok: false as const, reason: safeRead.kind };
      }
      const bytes = safeRead.bytes;
      const entry = { text: bytes.toString('utf8'), blobSha256: sha256(bytes) };
      fileMemo.set(path, entry);
      return { ok: true as const, text: entry.text };
    },
  };
  for (const path of (await enumerateFiles(resolvedRoot)).filter(
    (item) => !isExtraIgnored(item, policy.extraIgnores),
  )) {
    const safeRead = await readSafeSource(resolvedRoot, path, policy.maxFileSizeBytes);
    if (!safeRead.ok) {
      if (dirtySet.has(path) && safeRead.errorCode === 'ENOENT') continue;
      const base: ManifestFile = {
        path,
        blobSha256: '',
        sizeBytes: safeRead.sizeBytes,
        language: detectLanguage(path),
        category: detectCategory(path),
        status: 'skipped',
        reason: safeRead.kind === 'oversize' ? 'oversize' : 'unsafe-file',
      };
      manifest.push(base);
      events.push({
        diagnostic:
          safeRead.kind === 'oversize'
            ? policy.classifyFailure('oversize', path, safeRead.detail)
            : {
                code: ARXIC_SOURCE_UNSAFE_FILE,
                severity: 'blocked',
                subject: path,
                message: safeRead.detail,
              },
      });
      continue;
    }
    const bytes = safeRead.bytes;
    const base: ManifestFile = {
      path,
      blobSha256: sha256(bytes),
      sizeBytes: bytes.byteLength,
      language: detectLanguage(path),
      category: detectCategory(path),
      status: 'skipped',
    };
    if (dirtySet.has(path)) {
      base.reason = 'dirty';
      manifest.push(base);
      continue;
    }
    if (isBinary(bytes)) {
      base.reason = 'binary';
      manifest.push(base);
      events.push({
        diagnostic: policy.classifyFailure(
          'binary',
          path,
          'NUL byte detected; file was not parsed.',
        ),
      });
      continue;
    }
    const requestedLanguages = input.languages ?? policy.supportedLanguages;
    if (
      !policy.supportedLanguages.includes(base.language as SupportedSourceLanguage) ||
      !(requestedLanguages as readonly string[]).includes(base.language)
    ) {
      base.reason = 'unsupported-language';
      manifest.push(base);
      events.push({
        diagnostic: policy.classifyFailure(
          'unsupported-language',
          path,
          base.language === 'unsupported'
            ? `No language is identified for ${path}; the file is outside scan policy.`
            : `Language ${base.language} is outside scan policy.`,
        ),
      });
      continue;
    }

    let parsed: ParsedSource;
    try {
      parsed = parser.parse(path, base.language as SupportedSourceLanguage, bytes.toString('utf8'));
    } catch (error) {
      if (error instanceof GrammarUnavailableError) {
        // Bundled runtimes that do not carry the grammar package (the worker
        // bundle today) must fail visibly per file, never silently or at boot.
        base.reason = 'grammar-unavailable';
        manifest.push(base);
        events.push({
          diagnostic: {
            code: ARXIC_SOURCE_GRAMMAR_UNAVAILABLE,
            severity: 'blocked',
            subject: path,
            message: error.message,
          },
        });
        const inventory = inventoryOf(base.language);
        if (inventory) {
          inventory.gaps.push({
            kind: 'unsupported',
            sourcePath: path,
            reason: `grammar unavailable in this runtime: ${error.message}`,
          });
          inventory.files.set(path, { path, sha256: base.blobSha256 });
        }
        continue;
      }
      throw error;
    }
    try {
      if (parsed.hasError) {
        base.reason = 'parse-error';
        manifest.push(base);
        events.push({
          diagnostic: policy.classifyFailure(
            'parse-error',
            path,
            'Tree-sitter returned an error or partial parse tree.',
          ),
        });
        // Pack-language parse failures join the interchange gaps[] (never a
        // silent drop of a file the pack could not enumerate).
        const inventory = inventoryOf(base.language);
        if (inventory) {
          inventory.gaps.push({
            kind: 'parse-error',
            sourcePath: path,
            reason: 'Tree-sitter returned an error or partial parse tree.',
          });
          inventory.files.set(path, { path, sha256: base.blobSha256 });
        }
        continue;
      }
      base.status = 'indexed';
      manifest.push(base);
      const pack = languagePackFor(base.language);
      if (pack) {
        const extraction = await extractWithPack({ path, parsed, access: packAccess, pack });
        for (const advisory of extraction.advisories) events.push({ diagnostic: advisory });
        for (const finding of extraction.findings) {
          events.push({ ref: toRef(input.revision.repository, commit, base, finding, versions) });
        }
        for (const finding of [...extraction.routeFindings, ...extraction.crossFileFindings]) {
          const sha =
            finding.kind === 'handler'
              ? (fileMemo.get(finding.path)?.blobSha256 ?? '')
              : base.blobSha256;
          events.push({
            ref: toRef(
              input.revision.repository,
              commit,
              finding.kind === 'handler'
                ? { path: finding.path, blobSha256: sha, language: 'php' }
                : base,
              finding,
              versions,
            ),
          });
        }
        // Interchange aggregation: rows/gaps/files for this pack's language.
        if (extraction.routes.length > 0 || extraction.gaps.length > 0) {
          const inventory = inventoryOf(base.language);
          if (inventory) {
            inventory.routes.push(...extraction.routes);
            inventory.gaps.push(...extraction.gaps);
            inventory.files.set(path, { path, sha256: base.blobSha256 });
          }
        }
      } else {
        const findings: Array<SourceFinding | ReturnType<typeof extractFrameworkRoutes>[number]> = [
          ...extractTypeScript(parsed.root),
          ...extractFrameworkRoutes(path, parsed.root),
        ];
        for (const finding of findings) {
          events.push({
            ref: toRef(input.revision.repository, commit, base, finding, versions),
          });
        }
      }
    } finally {
      parsed.dispose();
    }
  }

  const inventories = [...packInventories.values()]
    .filter(
      (accumulator) =>
        (accumulator.routes.length > 0 || accumulator.gaps.length > 0) &&
        // Interchange provenance requires a real commit (40-hex). Every path
        // that reaches file processing has one; guard rather than emit a
        // document the validator would reject.
        commit !== null,
    )
    .map((accumulator) =>
      toRouteInventoryInterchange({
        packId: accumulator.packId,
        language: accumulator.language,
        ...(accumulator.framework !== undefined ? { framework: accumulator.framework } : {}),
        provenance: { repository: input.revision.repository, commit: commit as string },
        routes: accumulator.routes,
        gaps: accumulator.gaps,
        files: [...accumulator.files.values()],
      }),
    );

  return {
    revision: { repository: input.revision.repository, commit, dirty: dirty.length > 0 },
    manifest,
    events,
    toolVersions: versions,
    ...(inventories.length > 0 ? { inventories } : {}),
  };
}

function toRef(
  repo: string,
  commit: string,
  file: Pick<ManifestFile, 'path' | 'blobSha256' | 'language'>,
  finding:
    | SourceFinding
    | ReturnType<typeof extractFrameworkRoutes>[number]
    | RouteFindingPack
    | CrossFileFinding,
  versions: Record<string, string>,
): EvidenceRefSource {
  let extractor: string;
  if ('extractor' in finding && finding.extractor === 'nextjs') {
    extractor = 'source-ua-adapter/nextjs-file-conventions@0.0.0';
  } else if ('extractor' in finding && finding.extractor === 'laravel') {
    extractor = 'source-ua-adapter/laravel-route-inventory@1';
  } else {
    const packageName =
      file.language === 'typescript'
        ? 'tree-sitter-typescript'
        : file.language === 'php'
          ? 'tree-sitter-php'
          : 'tree-sitter-javascript';
    extractor = `${packageName}@${versions[packageName]}`;
  }
  return {
    kind: 'source',
    repo,
    commit,
    path: file.path,
    startLine: finding.startLine,
    endLine: finding.endLine,
    blobSha256: file.blobSha256,
    extractor,
    ruleId: `${finding.kind}:${finding.value}`,
  };
}

function toolVersions(): Record<string, string> {
  return Object.fromEntries(
    ['tree-sitter', 'tree-sitter-javascript', 'tree-sitter-typescript', 'tree-sitter-php'].flatMap(
      (name) => {
        // The PHP grammar is an optional carrier in bundled runtimes (the
        // worker bundle today); omit its version there instead of failing
        // provenance for every scan.
        try {
          const pkg = require(`${name}/package.json`) as { version: string };
          return [[name, pkg.version] as const];
        } catch {
          return [];
        }
      },
    ),
  );
}
