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

const LANGUAGES: Record<string, SupportedSourceLanguage> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.php': 'php',
};

export function detectLanguage(path: string): string {
  return LANGUAGES[extname(path).toLowerCase()] ?? 'unsupported';
}

export function detectCategory(path: string): SourceCategory {
  const ext = extname(path).toLowerCase();
  if (['.md', '.mdx', '.txt'].includes(ext)) return 'docs';
  if (['.css', '.scss', '.html'].includes(ext)) return 'markup';
  if (['.json', '.yaml', '.yml', '.toml'].includes(ext)) return 'config';
  if (LANGUAGES[ext]) return 'code';
  return 'other';
}

export function isBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, 8192).includes(0);
}
