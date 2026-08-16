import { describe, expect, it } from 'vitest';
import { ARXIC_SOURCE_UNSUPPORTED_LANGUAGE, diagnosticsOf, SourceUaAdapter } from '../index';
import { makeRepository } from './test-repo';

// Sad-path-first: a mixed-language monorepo (the campaign shape — TS + JS + PHP
// + known-but-unpackable languages + unknown extensions in ONE tree) must scan
// green with accurate per-language classification. The campaign defect being
// fixed here: the old template read "Language unsupported is outside scan
// policy" (detectLanguage returned the literal 'unsupported') and .mts files
// fell through entirely (ADR-008 Decision 5: per-pack advisories name the
// actual language; a missing pack must never be a misleading generic condition).

const PHP_ROUTES = `<?php

use App\\Http\\Controllers\\SongController;
use Illuminate\\Support\\Facades\\Route;

Route::get('songs', [SongController::class, 'index']);
`;

const SONG_CONTROLLER = `<?php

namespace App\\Http\\Controllers;

class SongController
{
    public function index()
    {
    }
}
`;

function mixedTree(): Record<string, string> {
  return {
    'composer.json': JSON.stringify({
      name: 'acme/mixed',
      autoload: { 'psr-4': { 'App\\': 'app/' } },
    }),
    'app/Http/Controllers/SongController.php': SONG_CONTROLLER,
    'routes/api.php': PHP_ROUTES,
    'frontend/app.ts': 'export const id = (x: number): number => x;\n',
    'frontend/lib.mts': 'export const helper = (x: number): number => x * 2;\n',
    'frontend/legacy.js': 'module.exports = function old() { return 1; };\n',
    'backend/service.rb': 'def greet; end\n',
    'scripts/tool.py': 'def main():\n    pass\n',
    'assets/blob.xyz': 'not code at all\n',
  };
}

describe('mixed-language monorepo scanning — accurate language naming (DG-05)', () => {
  it('indexes .mts as TypeScript (campaign gap fixed) and keeps TS/JS/PHP green in one tree', async () => {
    const repo = await makeRepository(undefined, mixedTree());
    const document = await new SourceUaAdapter().collect(repo.request);

    const byPath = new Map(document.manifest.map((file) => [file.path, file]));
    expect(byPath.get('frontend/lib.mts')).toMatchObject({
      language: 'typescript',
      category: 'code',
      status: 'indexed',
    });
    expect(byPath.get('frontend/app.ts')).toMatchObject({
      language: 'typescript',
      status: 'indexed',
    });
    expect(byPath.get('frontend/legacy.js')).toMatchObject({
      language: 'javascript',
      status: 'indexed',
    });
    expect(byPath.get('routes/api.php')).toMatchObject({ language: 'php', status: 'indexed' });

    // The .mts module produced real TypeScript evidence (parsed, not skipped).
    expect(
      document.events.some(
        (event) =>
          'ref' in event && event.ref.kind === 'source' && event.ref.path === 'frontend/lib.mts',
      ),
    ).toBe(true);

    // PHP routes still extract alongside the TS surface in the same scan.
    expect(
      document.events.some(
        (event) =>
          'ref' in event && event.ref.kind === 'source' && event.ref.ruleId === 'route:GET /songs',
      ),
    ).toBe(true);

    // Zero scan failures: every file is indexed or skipped with an accurate reason.
    const failures = document.manifest.filter(
      (file) => file.status === 'skipped' && file.reason === 'parse-error',
    );
    expect(failures).toEqual([]);
  });

  it('names known-but-unsupported languages accurately instead of the literal "unsupported"', async () => {
    const repo = await makeRepository(undefined, mixedTree());
    const document = await new SourceUaAdapter().collect(repo.request);

    const ruby = document.manifest.find((file) => file.path === 'backend/service.rb');
    expect(ruby).toMatchObject({
      language: 'ruby',
      category: 'code',
      status: 'skipped',
      reason: 'unsupported-language',
    });
    const python = document.manifest.find((file) => file.path === 'scripts/tool.py');
    expect(python).toMatchObject({
      language: 'python',
      status: 'skipped',
      reason: 'unsupported-language',
    });

    const diagnostics = diagnosticsOf(document.events).filter(
      (item) => item.code === ARXIC_SOURCE_UNSUPPORTED_LANGUAGE,
    );
    const rubyDiagnostic = diagnostics.find((item) => item.subject === 'backend/service.rb');
    // ADR-008 Decision 5: the advisory names the actual language.
    expect(rubyDiagnostic?.message).toBe('Language ruby is outside scan policy.');
    const unknown = diagnostics.find((item) => item.subject === 'assets/blob.xyz');
    // Unknown extensions are honest about being unidentified — never "unsupported".
    expect(unknown?.message).toBe(
      'No language is identified for assets/blob.xyz; the file is outside scan policy.',
    );
  });
});
