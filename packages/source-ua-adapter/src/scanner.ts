import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { EvidenceEvent, EvidenceRefSource, SourceIndexRequest } from '@arxic/contracts';
import { dirtyPaths, enumerateFiles, isShallowRepository, resolveCommit } from './git';
import {
  detectCategory,
  detectLanguage,
  isBinary,
  readManifestBytes,
  sha256,
  type ManifestFile,
} from './manifest';
import { SourceParser } from './parser';
import { extractTypeScript, type SourceFinding } from './extractors/typescript';
import { extractFrameworkRoutes } from './framework-registry';
import { isExtraIgnored, type SourceScanPolicy, type SupportedSourceLanguage } from './policy';

const require = createRequire(import.meta.url);

export type ScanDocument = {
  revision: { repository: string; commit: string | null; dirty: boolean };
  manifest: ManifestFile[];
  events: EvidenceEvent[];
  toolVersions: Record<string, string>;
};

export async function scanRepository(
  input: SourceIndexRequest,
  policy: SourceScanPolicy,
): Promise<ScanDocument> {
  const events: EvidenceEvent[] = [];
  const manifest: ManifestFile[] = [];
  const versions = toolVersions();
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

  const commit = await resolveCommit(root);
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
  if (await isShallowRepository(root)) {
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

  const dirty = await dirtyPaths(root);
  const dirtySet = new Set(dirty);
  if (dirty.length > 0) {
    events.push({
      diagnostic: policy.classifyFailure('dirty', '.', `Uncommitted paths: ${dirty.join(', ')}`),
    });
  }

  const parser = new SourceParser();
  for (const path of (await enumerateFiles(root)).filter(
    (item) => !isExtraIgnored(item, policy.extraIgnores),
  )) {
    let bytes: Buffer;
    try {
      bytes = await readManifestBytes(root, path);
    } catch (error) {
      if (dirtySet.has(path)) continue;
      throw error;
    }
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
    if (bytes.byteLength > policy.maxFileSizeBytes) {
      base.reason = 'oversize';
      manifest.push(base);
      events.push({
        diagnostic: policy.classifyFailure(
          'oversize',
          path,
          `${bytes.byteLength} bytes exceeds quota ${policy.maxFileSizeBytes}.`,
        ),
      });
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
          `Language ${base.language} is outside scan policy.`,
        ),
      });
      continue;
    }

    const parsed = parser.parse(
      path,
      base.language as SupportedSourceLanguage,
      bytes.toString('utf8'),
    );
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
        continue;
      }
      base.status = 'indexed';
      manifest.push(base);
      const findings: Array<SourceFinding | ReturnType<typeof extractFrameworkRoutes>[number]> = [
        ...extractTypeScript(parsed.root),
        ...extractFrameworkRoutes(path, parsed.root),
      ];
      for (const finding of findings) {
        events.push({
          ref: toRef(input.revision.repository, commit, base, finding, versions),
        });
      }
    } finally {
      parsed.dispose();
    }
  }

  return {
    revision: { repository: input.revision.repository, commit, dirty: dirty.length > 0 },
    manifest,
    events,
    toolVersions: versions,
  };
}

function toRef(
  repo: string,
  commit: string,
  file: ManifestFile,
  finding: SourceFinding | ReturnType<typeof extractFrameworkRoutes>[number],
  versions: Record<string, string>,
): EvidenceRefSource {
  let extractor: string;
  if ('extractor' in finding && finding.extractor === 'nextjs') {
    extractor = 'source-ua-adapter/nextjs-file-conventions@0.0.0';
  } else {
    const packageName =
      file.language === 'typescript' ? 'tree-sitter-typescript' : 'tree-sitter-javascript';
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
    ['tree-sitter', 'tree-sitter-javascript', 'tree-sitter-typescript'].map((name) => {
      const pkg = require(`${name}/package.json`) as { version: string };
      return [name, pkg.version];
    }),
  );
}
