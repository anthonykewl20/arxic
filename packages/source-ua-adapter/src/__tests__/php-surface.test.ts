import { describe, expect, it } from 'vitest';
import { DEFAULT_SOURCE_SCAN_POLICY, SourceUaAdapter } from '../index';
import type { SourceScanPolicy, SupportedSourceLanguage } from '../policy';
import { makeRepository } from './test-repo';

// Sad paths first: a PHP file that fails to parse must be a visible per-file
// skip (manifest reason + diagnostic), never a silent omission (ADR-008 §Risk
// "Tree-sitter grammar gaps on legacy PHP"; ADR-008 Decision 2).

describe('PHP language surface behind the SourceIndexer seam — sad paths', () => {
  it('skips a malformed PHP file with a visible parse-error diagnostic and manifest reason', async () => {
    const repo = await makeRepository(undefined, {
      'routes/broken.php': "<?php Route::get('x', [C::class, 'm']); function broken( {\n",
    });
    const adapter = new SourceUaAdapter();
    const document = await adapter.collect(repo.request);
    const broken = document.manifest.find((file) => file.path === 'routes/broken.php');
    expect(broken).toMatchObject({
      language: 'php',
      status: 'skipped',
      reason: 'parse-error',
    });
    const diagnostic = document.events.find(
      (event) =>
        'diagnostic' in event &&
        event.diagnostic.code === 'ARXIC-SOURCE-PARSE-ERROR' &&
        event.diagnostic.subject === 'routes/broken.php',
    );
    expect(diagnostic).toBeDefined();
  });

  it('reports php as unsupported-language when policy narrows back to TS/JS (campaign shape)', async () => {
    const repo = await makeRepository(undefined, {
      'app/Thing.php': '<?php\n\nnamespace App;\n\nclass Thing\n{\n}\n',
    });
    const legacyPolicy: SourceScanPolicy = {
      ...DEFAULT_SOURCE_SCAN_POLICY,
      supportedLanguages: Object.freeze<SupportedSourceLanguage[]>(['typescript', 'javascript']),
    };
    const adapter = new SourceUaAdapter({ policy: legacyPolicy });
    const document = await adapter.collect(repo.request);
    const php = document.manifest.find((file) => file.path === 'app/Thing.php');
    expect(php).toMatchObject({
      language: 'php',
      status: 'skipped',
      reason: 'unsupported-language',
    });
    const diagnostic = document.events.find(
      (event) =>
        'diagnostic' in event &&
        event.diagnostic.code === 'ARXIC-SOURCE-UNSUPPORTED-LANGUAGE' &&
        event.diagnostic.subject === 'app/Thing.php',
    );
    // The diagnostic names the actual language (ADR-008 Decision 5).
    expect(diagnostic && 'diagnostic' in diagnostic && diagnostic.diagnostic.message).toContain(
      'Language php is outside scan policy',
    );
  });

  it('does not laravel-scan a php file outside any Route facade use', async () => {
    const repo = await makeRepository(undefined, {
      'app/Support/plain.php': '<?php\n\nfunction helper()\n{\n    return 1;\n}\n',
    });
    const adapter = new SourceUaAdapter();
    const document = await adapter.collect(repo.request);
    const routeEvents = document.events.filter(
      (event) =>
        'ref' in event && event.ref.kind === 'source' && event.ref.ruleId?.startsWith('route:'),
    );
    expect(routeEvents).toEqual([]);
    expect(
      document.events.some(
        (event) =>
          'ref' in event &&
          event.ref.kind === 'source' &&
          event.ref.path === 'app/Support/plain.php',
      ),
    ).toBe(true);
  });
});
