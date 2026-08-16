// Language Pack SPI (DG-01 prototype shape — feeds ADR-008 Decision 5 via
// docs/spikes/dg-01-language-pack-spi.md; the production SPI lands with DG-05 #249).
//
// A language pack re-exposes the upstream Understand-Anything language surface
// through Arxic's frozen SourceIndexer seam: the grammar is data (an npm
// tree-sitter package reference, mirroring upstream's LanguageConfig.treeSitter
// `{ wasmPackage, wasmFile }` shape), extraction is code behind a narrow
// interface, and framework rules (Laravel today) are data-driven inventory
// engines layered on the same parsed tree.

import type { ParsedSource } from '../parser';
import type { SourceFinding } from '../extractors/typescript';
import type { Diagnostic } from '@arxic/contracts';
import { inventoryLaravelRoutes, type RepoFileAccess } from './php/laravel-routes';
import { extractPhp } from './php/php-symbols';

export type LanguagePackGrammar = {
  /** npm package providing the grammar (e.g. 'tree-sitter-php'). */
  readonly packageName: string;
  /** Named export for multi-grammar packages ('php' | 'php_only' for PHP). */
  readonly exportKey?: string;
};

export type CrossFileFinding = {
  kind: 'handler';
  value: string;
  startLine: number;
  endLine: number;
  /** Repo-relative path of the file the finding anchors to (controller file). */
  path: string;
  extractor: 'laravel';
};

export type RouteFindingPack = {
  kind: 'route';
  value: string;
  startLine: number;
  endLine: number;
  extractor: 'laravel';
};

export type LanguagePackExtraction = {
  findings: SourceFinding[];
  routeFindings: RouteFindingPack[];
  crossFileFindings: CrossFileFinding[];
  advisories: Diagnostic[];
};

export type LanguagePackContext = {
  /** Repo-relative path of the file being extracted. */
  path: string;
  /** Parsed tree for the file. */
  parsed: ParsedSource;
  /** Safe cross-file reads (controller convention resolution). */
  access: RepoFileAccess;
};

export type LanguagePack = {
  readonly id: string;
  readonly extensions: readonly string[];
  readonly grammar: LanguagePackGrammar;
  /** Framework inventory rule sets applied on top of the parsed surface. */
  readonly frameworkRules: readonly string[];
  extract(context: LanguagePackContext): Promise<LanguagePackExtraction>;
};

export const phpLanguagePack: LanguagePack = {
  id: 'php',
  extensions: ['.php'],
  grammar: { packageName: 'tree-sitter-php', exportKey: 'php' },
  frameworkRules: ['laravel-route-inventory@1'],
  async extract({ path, parsed, access }) {
    const laravel = await inventoryLaravelRoutes({ path, parsed, access });
    const routeFindings: RouteFindingPack[] = laravel.routes.map((route) => ({
      kind: 'route',
      value: `${route.method} ${route.uri}`,
      startLine: route.startLine,
      endLine: route.endLine,
      extractor: 'laravel',
    }));
    const crossFileFindings: CrossFileFinding[] = laravel.handlerRefs.map((ref) => ({
      kind: 'handler',
      value: `${ref.controller}::${ref.method}`,
      startLine: ref.startLine,
      endLine: ref.endLine,
      path: ref.path,
      extractor: 'laravel',
    }));
    return {
      findings: extractPhp(parsed.root),
      routeFindings,
      crossFileFindings,
      advisories: laravel.advisories,
    };
  },
};

export const builtinLanguagePacks: readonly LanguagePack[] = [phpLanguagePack];

export function languagePackFor(language: string): LanguagePack | undefined {
  return builtinLanguagePacks.find((pack) => pack.id === language);
}
