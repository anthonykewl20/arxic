// Language Pack SPI (DG-05 productionization of the DG-01 prototype shape;
// ADR-008 Decision 5).
//
// A language pack is DATA plus two narrow code surfaces, re-exposing the
// upstream Understand-Anything language surface through Arxic's frozen
// `SourceIndexer` seam:
//   - `grammar` — which npm grammar package carries the language (the same
//     artifact upstream's LanguageConfig.treeSitter declares; ADR-008 records
//     the adaptation mechanism and the tree-sitter-php 0.23.x exact-line pin);
//   - `extractSymbols` — the upstream-mapped structural surface (symbols,
//     imports, calls → SourceFinding evidence);
//   - `frameworkRules` — versioned Arxic-owned inventory rule layers. Each
//     rule is data-addressable (id + version + framework) and produces
//     line-anchored route rows, handler refs, advisories, and structured gaps.
//
// Evidence identity: symbol findings keep the grammar extractor string;
// rule output keeps `source-ua-adapter/<rule-id>@<version>`. The interchange
// pack identity (`inventoryPackId`, `arxic-langpack-php@1.0.0`) versions the
// pack bundle and is what Domain Inventory consumers see.
//
// Packs are adapter-level additions; frozen contracts do not change.

import type { SyntaxNode } from '../parser';
import type { ParsedSource } from '../parser';
import type { SourceFinding } from '../extractors/typescript';
import type { Diagnostic } from '@arxic/contracts';
import { inventoryLaravelRoutes, type RepoFileAccess } from './php/laravel-routes';
import { extractPhp } from './php/php-symbols';
import type { LaravelGap, LaravelHandlerRef, LaravelRouteRow } from './php/laravel-routes';

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

export type FrameworkInventoryRule = {
  /** Rule identity — also the evidence extractor suffix (`<id>@<version>`). */
  readonly id: string;
  /** Rule version; evidence rows carry it, so bump ONLY on semantic change. */
  readonly version: string;
  /** Framework the rules model (interchange `framework` field). */
  readonly framework: string;
  /** Coarse file gate; the engine no-ops on files without facade calls. */
  appliesTo(path: string): boolean;
  inventory(input: RuleInventoryInput): Promise<RuleInventoryResult>;
};

export type RuleInventoryInput = {
  path: string;
  parsed: ParsedSource;
  access: RepoFileAccess;
};

export type RuleInventoryResult = {
  routes: LaravelRouteRow[];
  handlerRefs: LaravelHandlerRef[];
  advisories: Diagnostic[];
  gaps: LaravelGap[];
};

export type LanguagePack = {
  readonly id: string;
  readonly extensions: readonly string[];
  readonly grammar: LanguagePackGrammar;
  /** Interchange pack identity (`name@version`) — real packs are versioned. */
  readonly inventoryPackId: string;
  /** Structural surface (upstream mapping) — pure, synchronous, evidence-only. */
  extractSymbols(root: SyntaxNode, path: string): SourceFinding[];
  /** Versioned framework inventory rule layers (data-addressable). */
  readonly frameworkRules: readonly FrameworkInventoryRule[];
};

const laravelRouteInventory: FrameworkInventoryRule = {
  id: 'laravel-route-inventory',
  version: '1',
  framework: 'laravel',
  appliesTo: (path) => path.endsWith('.php'),
  inventory: async ({ path, parsed, access }) => inventoryLaravelRoutes({ path, parsed, access }),
};

export const phpLanguagePack: LanguagePack = {
  id: 'php',
  extensions: ['.php'],
  grammar: { packageName: 'tree-sitter-php', exportKey: 'php' },
  inventoryPackId: 'arxic-langpack-php@1.0.0',
  extractSymbols: (root) => extractPhp(root),
  frameworkRules: [laravelRouteInventory],
};

export const builtinLanguagePacks: readonly LanguagePack[] = [phpLanguagePack];

export function languagePackFor(language: string): LanguagePack | undefined {
  return builtinLanguagePacks.find((pack) => pack.id === language);
}

/** Extractor strings for rule-produced evidence (scanner → EvidenceRef). */
export function ruleExtractorOf(rule: FrameworkInventoryRule): string {
  return `source-ua-adapter/${rule.id}@${rule.version}`;
}

// ---------------------------------------------------------------------------
// Backwards-compatible re-exports (DG-01 shape) — the scanner consumes these.
// ---------------------------------------------------------------------------

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

/** Composed extraction over the pack (symbols + every applicable rule). */
export async function extractWithPack(input: {
  path: string;
  parsed: ParsedSource;
  access: RepoFileAccess;
  pack: LanguagePack;
}): Promise<LanguagePackExtraction & RuleInventoryResult> {
  const { pack } = input;
  const findings = pack.extractSymbols(input.parsed.root, input.path);
  const routes: LaravelRouteRow[] = [];
  const handlerRefs: LaravelHandlerRef[] = [];
  const advisories: Diagnostic[] = [];
  const gaps: LaravelGap[] = [];
  for (const rule of pack.frameworkRules) {
    if (!rule.appliesTo(input.path)) continue;
    const result = await rule.inventory({
      path: input.path,
      parsed: input.parsed,
      access: input.access,
    });
    routes.push(...result.routes);
    handlerRefs.push(...result.handlerRefs);
    advisories.push(...result.advisories);
    gaps.push(...result.gaps);
  }
  const routeFindings: RouteFindingPack[] = routes.map((route) => ({
    kind: 'route',
    value: `${route.method} ${route.uri}`,
    startLine: route.startLine,
    endLine: route.endLine,
    extractor: 'laravel',
  }));
  const crossFileFindings: CrossFileFinding[] = handlerRefs.map((ref) => ({
    kind: 'handler',
    value: `${ref.controller}::${ref.method}`,
    startLine: ref.startLine,
    endLine: ref.endLine,
    path: ref.path,
    extractor: 'laravel',
  }));
  return { findings, routeFindings, crossFileFindings, advisories, routes, handlerRefs, gaps };
}
