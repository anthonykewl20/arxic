import { readFileSync } from 'node:fs';
import { formatVersionLabel } from './version-policy.mjs';

export const ARXIC_VERSION =
  process.env.ARXIC_VERSION ??
  readFileSync(new URL('../../../VERSION', import.meta.url), 'utf8').trim();

export const ARXIC_VERSION_LABEL = formatVersionLabel(ARXIC_VERSION);
