import { readFile } from 'node:fs/promises';
import type { Diagnostic } from '@arxic/contracts';
import { parseDocument } from 'yaml';
import { ARXIC_CONFIG_MISSING, ARXIC_CONFIG_PARSE, cliDiagnostic } from '../diagnostics';
import type { ArxicConfig } from '@arxic/worker';
import { validateConfig } from './validate';

type LoadResult = { ok: true; value: ArxicConfig } | { ok: false; diagnostics: Diagnostic[] };

export async function loadConfig(path: string): Promise<LoadResult> {
  let bytes: string;
  try {
    bytes = await readFile(path, 'utf8');
  } catch (error) {
    const code =
      isNodeError(error) && error.code === 'ENOENT' ? ARXIC_CONFIG_MISSING : ARXIC_CONFIG_PARSE;
    return {
      ok: false,
      diagnostics: [
        cliDiagnostic(
          code,
          'blocked',
          'config',
          code === ARXIC_CONFIG_MISSING
            ? `Configuration file was not found: ${path}`
            : `Configuration file could not be read: ${path}`,
        ),
      ],
    };
  }
  try {
    const document = parseDocument(bytes);
    if (document.errors.length > 0) return parseFailure(path);
    return validateConfig(document.toJS() as unknown);
  } catch {
    return parseFailure(path);
  }
}

function parseFailure(path: string): LoadResult {
  return {
    ok: false,
    diagnostics: [
      cliDiagnostic(
        ARXIC_CONFIG_PARSE,
        'blocked',
        'config',
        `Configuration file is not valid YAML: ${path}`,
      ),
    ],
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
