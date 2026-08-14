import { readFileSync } from 'node:fs';

export const ARXIC_VERSION =
  process.env.ARXIC_VERSION ??
  readFileSync(new URL('../../../VERSION', import.meta.url), 'utf8').trim();
