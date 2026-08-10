import { readFileSync } from 'node:fs';

const sourceUrl = new URL('./standalone-runtime.ts', import.meta.url);

export function screenshotPrivacyRuntimeSource(): string {
  return readFileSync(sourceUrl, 'utf8');
}
