export { sha256 } from '@arxic/contracts';
import { extname } from 'node:path';
import type { SupportedSourceLanguage } from './policy';

export type SourceCategory = 'code' | 'docs' | 'markup' | 'config' | 'other';
export type ManifestFile = {
  path: string;
  blobSha256: string;
  sizeBytes: number;
  language: string;
  category: SourceCategory;
  status: 'indexed' | 'skipped';
  reason?:
    | 'binary'
    | 'oversize'
    | 'parse-error'
    | 'unsupported-language'
    | 'dirty'
    | 'unsafe-file'
    | 'grammar-unavailable';
};

/** Languages this adapter can PARSE (policy.supportedLanguages candidates). */
const LANGUAGES: Record<string, SupportedSourceLanguage> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.php': 'php',
};

/**
 * Languages this adapter can IDENTIFY but not parse. Detection-only map so
 * unsupported-language diagnostics and manifest rows name the actual language
 * (ADR-008 Decision 5) instead of the misleading literal `unsupported` that
 * the 2026-08-16 campaign surfaced. Language ids follow the upstream
 * Understand-Anything grammar-bearing config census (DG-01 §1.2).
 */
const DETECTED_LANGUAGES: Readonly<Record<string, string>> = Object.freeze({
  '.rb': 'ruby',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.cs': 'csharp',
  '.swift': 'swift',
  '.dart': 'dart',
  '.scala': 'scala',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.hpp': 'cpp',
  '.lua': 'lua',
});

export function detectLanguage(path: string): string {
  const extension = extname(path).toLowerCase();
  return LANGUAGES[extension] ?? DETECTED_LANGUAGES[extension] ?? 'unsupported';
}

export function detectCategory(path: string): SourceCategory {
  const ext = extname(path).toLowerCase();
  if (['.md', '.mdx', '.txt'].includes(ext)) return 'docs';
  if (['.css', '.scss', '.html'].includes(ext)) return 'markup';
  if (['.json', '.yaml', '.yml', '.toml'].includes(ext)) return 'config';
  if (LANGUAGES[ext] ?? DETECTED_LANGUAGES[ext]) return 'code';
  return 'other';
}

export function isBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, 8192).includes(0);
}
