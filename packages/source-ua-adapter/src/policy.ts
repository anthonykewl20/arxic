import {
  ARXIC_SOURCE_BINARY_FILE,
  ARXIC_SOURCE_DIRTY_TREE,
  ARXIC_SOURCE_FILE_OVERSIZE,
  ARXIC_SOURCE_NO_COMMIT,
  ARXIC_SOURCE_PARSE_ERROR,
  ARXIC_SOURCE_REPOSITORY_UNAVAILABLE,
  ARXIC_SOURCE_REVISION_MISMATCH,
  ARXIC_SOURCE_SHALLOW_CLONE,
  ARXIC_SOURCE_UNSUPPORTED_LANGUAGE,
  sourceDiagnostic,
  type SourceDiagnosticCode,
} from './diagnostics';

export type SupportedSourceLanguage = 'typescript' | 'javascript' | 'php';

export type SourceScanFailure =
  | 'binary'
  | 'dirty'
  | 'no-commit'
  | 'oversize'
  | 'parse-error'
  | 'repository-unavailable'
  | 'revision-mismatch'
  | 'shallow'
  | 'unsupported-language';

export type SourceScanPolicy = {
  maxFileSizeBytes: number;
  supportedLanguages: readonly SupportedSourceLanguage[];
  extraIgnores: readonly string[];
  classifyFailure: (
    failure: SourceScanFailure,
    subject: string,
    detail: string,
  ) => ReturnType<typeof sourceDiagnostic>;
};

const FAILURE_CODES: Record<SourceScanFailure, SourceDiagnosticCode> = {
  binary: ARXIC_SOURCE_BINARY_FILE,
  dirty: ARXIC_SOURCE_DIRTY_TREE,
  'no-commit': ARXIC_SOURCE_NO_COMMIT,
  oversize: ARXIC_SOURCE_FILE_OVERSIZE,
  'parse-error': ARXIC_SOURCE_PARSE_ERROR,
  'repository-unavailable': ARXIC_SOURCE_REPOSITORY_UNAVAILABLE,
  'revision-mismatch': ARXIC_SOURCE_REVISION_MISMATCH,
  shallow: ARXIC_SOURCE_SHALLOW_CLONE,
  'unsupported-language': ARXIC_SOURCE_UNSUPPORTED_LANGUAGE,
};

export const DEFAULT_SOURCE_SCAN_POLICY: SourceScanPolicy = Object.freeze({
  maxFileSizeBytes: 1024 * 1024,
  supportedLanguages: Object.freeze<SupportedSourceLanguage[]>(['typescript', 'javascript', 'php']),
  extraIgnores: Object.freeze<string[]>([]),
  classifyFailure: (failure: SourceScanFailure, subject: string, detail: string) =>
    sourceDiagnostic(FAILURE_CODES[failure], subject, detail),
});

export function isExtraIgnored(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    const normalized = pattern.replace(/^\//u, '').replace(/\/$/u, '');
    if (!normalized) return false;
    const escaped = normalized
      .replace(/[.+?^${}()|[\]\\]/gu, '\\$&')
      .replaceAll('**', '§§')
      .replaceAll('*', '[^/]*')
      .replaceAll('§§', '.*');
    return new RegExp(`^(?:${escaped})(?:/.*)?$`, 'u').test(path);
  });
}
