import { sha256, type Diagnostic, type EvidenceRefSource } from '@arxic/contracts';
import { readSafeSource } from '@arxic/fs-safe';
import {
  ARXIC_RULES_FRAMEWORK_ACCEPTED,
  ARXIC_RULES_FRAMEWORK_REJECTED,
  ARXIC_RULES_FRAMEWORK_UNKNOWN,
  ARXIC_RULES_FRAMEWORK_UNDETECTED,
  ARXIC_RULES_FRAMEWORK_WAIVED,
  ARXIC_RULES_WAIVER_INVALID,
  rulesDiagnostic,
} from './diagnostics';
import { sourceFiles } from './git';
import { codepointCompare } from './runner';
import type { LoadedPack } from './packs';

/**
 * DG-10 framework gating (ADR-008 Decision 9).
 *
 * Deterministic framework+version detection from source evidence and normative
 * rulepack range enforcement. Evidence tiers, strongest first:
 *
 * 1. `lockfile`  — resolved, installed versions from pnpm-lock.yaml /
 *    package-lock.json / npm-shrinkwrap.json / yarn.lock (v1) / composer.lock.
 * 2. `manifest`  — declared dependency ranges from package.json / composer.json.
 *    A declared range only accepts when EVERY version it can install lies
 *    inside the pack range (containment, fail closed); an exact pin compares
 *    directly. Documented lower confidence: the manifest is an intention, not
 *    an installation.
 * 3. `imports`   — framework package imports in tracked TypeScript sources.
 *    Name-only corroboration with no version: emits an explicit
 *    VERSION-UNDETECTED diagnostic and never implies compatibility.
 *
 * A waiver is a recorded operator decision in a committed `arxic.waivers.json`
 * at the repository root — never an implicit compatibility claim.
 */

// ---------------------------------------------------------------------------
// Semver core (no external dependency; npm-range grammar subset)
// ---------------------------------------------------------------------------

export type SemVer = {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string[];
};

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u;

export function parseVersion(text: string): SemVer | undefined {
  const match = text.trim().match(VERSION_PATTERN);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    ...(match[4] === undefined ? {} : { prerelease: match[4].split('.') }),
  };
}

function comparePrereleaseIdentifiers(left: string, right: string): number {
  const leftNumeric = /^\d+$/u.test(left);
  const rightNumeric = /^\d+$/u.test(right);
  if (leftNumeric && rightNumeric) return Math.sign(Number(left) - Number(right));
  if (leftNumeric) return -1; // numeric identifiers always have lower precedence
  if (rightNumeric) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1; // release > prerelease
  if (right.length === 0) return -1;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined) return -1; // fewer identifiers = lower precedence
    if (b === undefined) return 1;
    const compared = comparePrereleaseIdentifiers(a, b);
    if (compared !== 0) return compared;
  }
  return 0;
}

export function compareVersions(left: SemVer, right: SemVer): number {
  const core = left.major - right.major || left.minor - right.minor || left.patch - right.patch;
  if (core !== 0) return Math.sign(core);
  return Math.sign(comparePrerelease(left.prerelease ?? [], right.prerelease ?? []));
}

const sameTuple = (left: SemVer, right: SemVer) =>
  left.major === right.major && left.minor === right.minor && left.patch === right.patch;

export type IntervalBound = { version: SemVer; inclusive: boolean };
export type Interval = { min?: IntervalBound; max?: IntervalBound };
export type Empty = { empty: true };

type PartialVersion = { nums: [number, number, number]; given: 0 | 1 | 2 | 3; wild: boolean };

function parsePartial(text: string): PartialVersion | undefined {
  if (text === '' || text === '*' || text === 'x' || text === 'X')
    return { nums: [0, 0, 0], given: 0, wild: true };
  const parts = text.split('.');
  const nums: number[] = [];
  let wild = false;
  for (const part of parts) {
    if (part === '*' || part === 'x' || part === 'X') {
      wild = true;
      break;
    }
    if (!/^\d+$/u.test(part)) return undefined;
    nums.push(Number(part));
    if (nums.length === 3) break;
  }
  if (nums.length === 0 || nums.length > 3) return undefined;
  if (nums.some((value) => !Number.isSafeInteger(value))) return undefined;
  const filled: [number, number, number] = [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0];
  return { nums: filled, given: nums.length as 1 | 2 | 3, wild };
}
const exact = (version: SemVer): Interval => ({
  min: { version, inclusive: true },
  max: { version, inclusive: true },
});

/** Full semver (prerelease allowed) first, then zero-padded partials. */
function asPartial(text: string): PartialVersion | undefined {
  const full = parseVersion(text);
  if (full) return { nums: [full.major, full.minor, full.patch], given: 3, wild: false };
  return parsePartial(text);
}

function caretInterval(partial: PartialVersion): Interval | undefined {
  const [major, minor, patch] = partial.nums;
  const low: SemVer = { major, minor, patch };
  let upper: SemVer;
  if (major > 0 || partial.given === 1) upper = { major: major + 1, minor: 0, patch: 0 };
  else if (minor > 0 || partial.given === 2) upper = { major, minor: minor + 1, patch: 0 };
  else upper = { major, minor, patch: patch + 1 };
  return { min: { version: low, inclusive: true }, max: { version: upper, inclusive: false } };
}

function tildeInterval(partial: PartialVersion): Interval | undefined {
  const [major, minor] = partial.nums;
  const low: SemVer = { major, minor, patch: partial.nums[2] };
  const upper: SemVer =
    partial.given === 1
      ? { major: major + 1, minor: 0, patch: 0 }
      : { major, minor: minor + 1, patch: 0 };
  return { min: { version: low, inclusive: true }, max: { version: upper, inclusive: false } };
}

function wildInterval(partial: PartialVersion): Interval | undefined {
  const [major, minor] = partial.nums;
  if (partial.given === 1)
    return {
      min: { version: { major, minor: 0, patch: 0 }, inclusive: true },
      max: { version: { major: major + 1, minor: 0, patch: 0 }, inclusive: false },
    };
  if (partial.given === 2)
    return {
      min: { version: { major, minor, patch: 0 }, inclusive: true },
      max: { version: { major, minor: minor + 1, patch: 0 }, inclusive: false },
    };
  return exact({ major, minor, patch: partial.nums[2] });
}

function comparatorInterval(token: string): Interval | undefined {
  const match = token.match(/^(>=|<=|>|<|=)?(.+)$/u);
  if (!match) return undefined;
  const operator = match[1] ?? '=';
  if (operator === '=' && (match[2] === '*' || match[2] === 'x' || match[2] === 'X')) return {};
  // Full semantic versions (including prerelease) parse directly; partials are
  // zero-padded — the supported grammar documents this (pack ranges and
  // real-world manifest comparators use full versions).
  const full = parseVersion(match[2]);
  if (full) {
    const version: SemVer = {
      major: full.major,
      minor: full.minor,
      patch: full.patch,
      ...(full.prerelease === undefined ? {} : { prerelease: full.prerelease }),
    };
    switch (operator) {
      case '>=':
        return { min: { version, inclusive: true } };
      case '>':
        return { min: { version, inclusive: false } };
      case '<=':
        return { max: { version, inclusive: true } };
      case '<':
        return { max: { version, inclusive: false } };
      default:
        return exact(version);
    }
  }
  const partial = parsePartial(match[2]);
  if (!partial) return undefined;
  const version: SemVer = {
    major: partial.nums[0],
    minor: partial.nums[1],
    patch: partial.nums[2],
  };
  switch (operator) {
    case '>=':
      return { min: { version, inclusive: true } };
    case '>':
      return { min: { version, inclusive: false } };
    case '<=':
      return { max: { version, inclusive: true } };
    case '<':
      return { max: { version, inclusive: false } };
    default:
      return exact(version);
  }
}

function tokenInterval(token: string): Interval | undefined {
  if (token.startsWith('^')) {
    const partial = asPartial(token.slice(1));
    return partial ? caretInterval(partial) : undefined;
  }
  if (token.startsWith('~')) {
    const partial = asPartial(token.slice(1));
    return partial ? tildeInterval(partial) : undefined;
  }
  const full = parseVersion(token);
  if (full)
    return exact({
      major: full.major,
      minor: full.minor,
      patch: full.patch,
      ...(full.prerelease === undefined ? {} : { prerelease: full.prerelease }),
    });
  if (/^\d/u.test(token) || /^[*xX]/u.test(token) || token.includes('.x') || token.includes('.*')) {
    const partial = parsePartial(token);
    if (!partial) return undefined;
    if (partial.given === 0) return {};
    if (partial.wild || partial.given < 3) return wildInterval(partial);
    return exact({ major: partial.nums[0], minor: partial.nums[1], patch: partial.nums[2] });
  }
  return comparatorInterval(token);
}

function intersect(left: Interval, right: Interval): Interval | Empty {
  let min = left.min;
  let max = left.max;
  if (right.min) {
    if (!min) min = right.min;
    else {
      const compared = compareVersions(min.version, right.min.version);
      if (compared < 0) min = right.min;
      else if (compared === 0)
        min = { version: min.version, inclusive: min.inclusive && right.min.inclusive };
    }
  }
  if (right.max) {
    if (!max) max = right.max;
    else {
      const compared = compareVersions(max.version, right.max.version);
      if (compared > 0) max = right.max;
      else if (compared === 0)
        max = { version: max.version, inclusive: max.inclusive && right.max.inclusive };
    }
  }
  if (min && max) {
    const compared = compareVersions(min.version, max.version);
    if (compared > 0) return { empty: true };
    if (compared === 0 && !(min.inclusive && max.inclusive)) return { empty: true };
  }
  return { min, max };
}

/**
 * Parses the supported npm-range grammar subset into a union of intervals:
 * `||` unions of comparator sets built from `>=`, `>`, `<=`, `<`, `=`, exact
 * versions, `^`/`~` ranges, hyphen ranges, and x-ranges (`16`, `16.2`, `16.x`,
 * `*`). Returns `undefined` for anything outside the grammar — callers fail
 * closed rather than guess.
 */
export function parseRange(text: string): Interval[] | undefined {
  const union = text.trim();
  if (union === '') return undefined;
  const intervals: Interval[] = [];
  for (const branchText of union.split('||')) {
    const branch = branchText.trim();
    if (branch === '') return undefined;
    const hyphen = branch.match(/^(\S+)\s+-\s+(\S+)$/u);
    let branchIntervals: Interval[] | undefined;
    if (hyphen) {
      const low = asPartial(hyphen[1]!);
      const high = asPartial(hyphen[2]!);
      if (!low || !high) return undefined;
      const lowVersion: SemVer = { major: low.nums[0], minor: low.nums[1], patch: low.nums[2] };
      // Partial upper ends widen per the npm spec: `1.2.3 - 2.3` => <2.4.0.
      const highBound: IntervalBound =
        high.wild || high.given < 3
          ? {
              version:
                high.given === 1
                  ? { major: high.nums[0] + 1, minor: 0, patch: 0 }
                  : { major: high.nums[0], minor: high.nums[1] + 1, patch: 0 },
              inclusive: false,
            }
          : {
              version: { major: high.nums[0], minor: high.nums[1], patch: high.nums[2] },
              inclusive: true,
            };
      branchIntervals = [{ min: { version: lowVersion, inclusive: true }, max: highBound }];
    } else {
      const tokens = branch.split(/\s+/u);
      let merged: Interval = {};
      let contradictory = false;
      for (const token of tokens) {
        if (token === '') continue;
        const interval = tokenInterval(token);
        if (!interval) return undefined;
        const next = intersect(merged, interval);
        if ('empty' in next) {
          // Comparator set matches nothing (e.g. `>16 <16`): the branch is the
          // empty set and contributes no candidate versions.
          contradictory = true;
          break;
        }
        merged = next;
      }
      branchIntervals = contradictory ? [] : [merged];
    }
    if (!branchIntervals) return undefined;
    intervals.push(...branchIntervals);
  }
  return intervals.length > 0 ? intervals : undefined;
}

const isPoint = (interval: Interval): boolean =>
  interval.min !== undefined &&
  interval.max !== undefined &&
  interval.min.inclusive &&
  interval.max.inclusive &&
  compareVersions(interval.min.version, interval.max.version) === 0;

/** npm prerelease rule: a prerelease version only satisfies a branch that has a
 * prerelease comparator bound on the same major.minor.patch tuple. */
function prereleaseAllowed(version: SemVer, pack: Interval): boolean {
  if (version.prerelease === undefined || version.prerelease.length === 0) return true;
  return [pack.min, pack.max].some(
    (bound) =>
      bound &&
      bound.version.prerelease !== undefined &&
      bound.version.prerelease.length > 0 &&
      sameTuple(bound.version, version),
  );
}

export function versionSatisfies(version: SemVer, pack: Interval[]): boolean {
  return pack.some((interval) => {
    if (!prereleaseAllowed(version, interval)) return false;
    if (interval.min) {
      const compared = compareVersions(version, interval.min.version);
      if (compared < 0 || (compared === 0 && !interval.min.inclusive)) return false;
    }
    if (interval.max) {
      const compared = compareVersions(version, interval.max.version);
      if (compared > 0 || (compared === 0 && !interval.max.inclusive)) return false;
    }
    return true;
  });
}

/** candidate lower bound sits at or above the pack's lower bound (a candidate
 * inclusive edge at the same version requires an inclusive pack edge). */
const minAtOrAbove = (candidate: IntervalBound, limit: IntervalBound): boolean => {
  const compared = compareVersions(candidate.version, limit.version);
  if (compared > 0) return true;
  if (compared < 0) return false;
  return !candidate.inclusive || limit.inclusive;
};

/** candidate upper bound sits at or below the pack's upper bound. */
const maxAtOrBelow = (candidate: IntervalBound, limit: IntervalBound): boolean => {
  const compared = compareVersions(candidate.version, limit.version);
  if (compared < 0) return true;
  if (compared > 0) return false;
  return !candidate.inclusive || limit.inclusive;
};

/** Bounded-half containment: a candidate bound escapes when it is unbounded on
 * a side the pack bounds. */
function halfContains(
  candidateBound: IntervalBound | undefined,
  packBound: IntervalBound | undefined,
  compare: (candidate: IntervalBound, limit: IntervalBound) => boolean,
): boolean {
  if (candidateBound === undefined) return packBound === undefined;
  if (packBound === undefined) return true;
  return compare(candidateBound, packBound);
}

/**
 * True when every version the candidate (manifest) range can install lies
 * inside the pack range. Fail closed: escaping bounds, even overlapping ones,
 * reject. Exact points delegate to `versionSatisfies` so the prerelease rule
 * applies uniformly.
 */
export function intervalContains(pack: Interval[], candidate: Interval[]): boolean {
  return candidate.every((candidateInterval) => {
    if (isPoint(candidateInterval)) return versionSatisfies(candidateInterval.min!.version, pack);
    return pack.some(
      (packInterval) =>
        halfContains(candidateInterval.min, packInterval.min, minAtOrAbove) &&
        halfContains(candidateInterval.max, packInterval.max, maxAtOrBelow),
    );
  });
}

// ---------------------------------------------------------------------------
// Framework registry and evidence detection
// ---------------------------------------------------------------------------

export type FrameworkEvidenceTier = 'lockfile' | 'manifest' | 'imports';

export type DetectedFramework = {
  name: string;
  version?: string;
  declaredRange?: string;
  tier: FrameworkEvidenceTier;
  evidence: EvidenceRefSource[];
};

export type FrameworkWaiver = {
  framework: string;
  version: string;
  packVersionRange: string;
  reason: string;
  approvedBy: string;
  recordedAt: string;
  evidence: EvidenceRefSource;
};

export type FrameworkDetection = {
  frameworks: DetectedFramework[];
  waivers: FrameworkWaiver[];
  waiverDiagnostics: Diagnostic[];
};

/** Framework-name evidence keyed by the packages that establish it. Node
 * packages get the imports tier; composer packages do not (tracked sources are
 * TypeScript-only today). */
const FRAMEWORK_PACKAGES: Readonly<Record<string, string>> = Object.freeze({
  next: 'nextjs',
  express: 'express',
  react: 'react',
  'laravel/framework': 'laravel',
});

const LOCKFILE_PATHS = [
  'pnpm-lock.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'composer.lock',
] as const;
const MANIFEST_PATHS = ['package.json', 'composer.json'] as const;
const WAIVER_PATH = 'arxic.waivers.json';
const EVIDENCE_MAX_BYTES = 8 * 1024 * 1024;

export const FRAMEWORK_GATE_PACKAGE = '@arxic/ast-grep-adapter' as const;

type EvidenceFile = { path: string; bytes: Buffer };

/** Normalized display/comparison form that PRESERVES prerelease tags — a
 * `16.0.0-rc.1` pin must never be flattened to `16.0.0` before range math. */
function formatVersion(version: {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string[];
}): string {
  return `${version.major}.${version.minor}.${version.patch}${
    version.prerelease === undefined || version.prerelease.length === 0
      ? ''
      : `-${version.prerelease.join('.')}`
  }`;
}

function lineOf(bytes: Buffer, needle: string, fromLine = 0): number | undefined {
  const lines = bytes.toString('utf8').split('\n');
  for (let index = fromLine; index < lines.length; index += 1)
    if (lines[index]!.includes(needle)) return index + 1;
  return undefined;
}

function evidenceRef(
  file: EvidenceFile,
  line: number,
  repository: string,
  commit: string,
  ruleId: string,
): EvidenceRefSource {
  const lineCount = file.bytes.toString('utf8').split('\n').length;
  return {
    kind: 'source',
    repo: repository,
    commit,
    path: file.path,
    startLine: Math.max(1, line),
    endLine: Math.min(Math.max(1, line), lineCount),
    blobSha256: sha256(file.bytes),
    extractor: FRAMEWORK_GATE_PACKAGE,
    ruleId,
  };
}

type Candidate = {
  name: string;
  version?: string;
  declaredRange?: string;
  tier: FrameworkEvidenceTier;
  file: EvidenceFile;
  line: number;
};

function nodeManifestCandidates(file: EvidenceFile): Candidate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.bytes.toString('utf8'));
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];
  const record = parsed as Record<string, unknown>;
  const found: Candidate[] = [];
  for (const section of ['dependencies', 'devDependencies'] as const) {
    const deps = record[section];
    if (typeof deps !== 'object' || deps === null) continue;
    for (const [pkg, range] of Object.entries(deps as Record<string, unknown>)) {
      const framework = FRAMEWORK_PACKAGES[pkg];
      if (!framework || typeof range !== 'string') continue;
      const line = lineOf(file.bytes, `"${pkg}"`);
      if (!line) continue;
      const exactVersion = parseVersion(range);
      found.push({
        name: framework,
        ...(exactVersion ? { version: formatVersion(exactVersion) } : {}),
        ...(range.trim() !== '' ? { declaredRange: range.trim() } : {}),
        tier: 'manifest',
        file,
        line,
      });
    }
  }
  return found;
}

function composerManifestCandidates(file: EvidenceFile): Candidate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.bytes.toString('utf8'));
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];
  const record = parsed as Record<string, unknown>;
  const found: Candidate[] = [];
  for (const section of ['require', 'require-dev'] as const) {
    const deps = record[section];
    if (typeof deps !== 'object' || deps === null) continue;
    for (const [pkg, range] of Object.entries(deps as Record<string, unknown>)) {
      const framework = FRAMEWORK_PACKAGES[pkg];
      if (!framework || typeof range !== 'string') continue;
      const line = lineOf(file.bytes, `"${pkg}"`);
      if (!line) continue;
      const normalized = range.trim().replace(/^v/u, '');
      const exactVersion = parseVersion(normalized);
      found.push({
        name: framework,
        ...(exactVersion ? { version: formatVersion(exactVersion) } : {}),
        ...(normalized !== '' ? { declaredRange: normalized } : {}),
        tier: 'manifest',
        file,
        line,
      });
    }
  }
  return found;
}

function jsonLockCandidates(file: EvidenceFile, packagePath: string): Candidate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.bytes.toString('utf8'));
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];
  const record = parsed as Record<string, unknown>;
  const versions = new Map<string, string>();
  const root =
    packagePath === 'package-lock.json' || packagePath === 'npm-shrinkwrap.json'
      ? ((record.packages as Record<string, unknown> | undefined)?.[''] as
          Record<string, unknown> | undefined)
      : undefined;
  const rootDeps =
    root && typeof root.dependencies === 'object' && root.dependencies !== null
      ? (root.dependencies as Record<string, unknown>)
      : undefined;
  if (rootDeps) {
    for (const [pkg, value] of Object.entries(rootDeps)) {
      if (FRAMEWORK_PACKAGES[pkg] && typeof value === 'string') versions.set(pkg, value);
    }
  }
  const legacy = record.dependencies as Record<string, Record<string, unknown>> | undefined;
  if (legacy && typeof legacy === 'object') {
    for (const [pkg, value] of Object.entries(legacy)) {
      if (FRAMEWORK_PACKAGES[pkg] && typeof value?.version === 'string')
        versions.set(pkg, value.version);
    }
  }
  if (packagePath === 'composer.lock') {
    for (const section of ['packages', 'packages-dev'] as const) {
      const list = record[section];
      if (!Array.isArray(list)) continue;
      for (const entry of list) {
        if (typeof entry !== 'object' || entry === null) continue;
        const { name, version } = entry as { name?: unknown; version?: unknown };
        if (typeof name === 'string' && FRAMEWORK_PACKAGES[name] && typeof version === 'string')
          versions.set(name, version);
      }
    }
  }
  const found: Candidate[] = [];
  for (const [pkg, rawVersion] of [...versions].sort(codepointCompareKV)) {
    const framework = FRAMEWORK_PACKAGES[pkg]!;
    const version = parseVersion(rawVersion.replace(/^v/u, ''));
    if (!version) continue;
    const line = lineOf(file.bytes, `"${pkg}"`) ?? lineOf(file.bytes, pkg) ?? 1;
    found.push({
      name: framework,
      version: formatVersion(version),
      tier: 'lockfile',
      file,
      line,
    });
  }
  return found;
}

function codepointCompareKV(left: [string, string], right: [string, string]): number {
  return codepointCompare(left[0], right[0]);
}

/** Tracked TypeScript files for the imports tier when the caller did not
 * already read them (standalone gate usage). Bounded and deterministic: the
 * first IMPORT_SCAN_FILE_LIMIT files in path order. A non-git root yields no
 * import evidence rather than an error. */
const IMPORT_SCAN_FILE_LIMIT = 500;
const IMPORT_SCAN_TOTAL_BYTES = 64 * 1024 * 1024;

async function trackedSourceBytes(root: string): Promise<Map<string, Buffer>> {
  const bytes = new Map<string, Buffer>();
  let tracked: string[];
  try {
    tracked = await sourceFiles(root);
  } catch {
    return bytes;
  }
  let total = 0;
  for (const path of tracked.slice(0, IMPORT_SCAN_FILE_LIMIT)) {
    const read = await readSafeSource(root, path, EVIDENCE_MAX_BYTES);
    if (!read.ok) continue;
    if (total + read.bytes.length > IMPORT_SCAN_TOTAL_BYTES) break; // deterministic path order caps the budget
    total += read.bytes.length;
    bytes.set(path, read.bytes);
  }
  return bytes;
}

function pnpmLockCandidates(file: EvidenceFile): Candidate[] {
  const text = file.bytes.toString('utf8');
  const lockfileVersion = text.match(/^lockfileVersion:\s*\S+/mu);
  if (!lockfileVersion) return [];
  const found: Candidate[] = [];
  const lines = text.split('\n');
  for (const pkg of Object.keys(FRAMEWORK_PACKAGES).filter((name) => !name.includes('/'))) {
    const framework = FRAMEWORK_PACKAGES[pkg]!;
    for (let index = 0; index < lines.length; index += 1) {
      // importer dependency blocks: `  next:` exactly (no @version suffix — that
      // would be a `packages:` entry), followed by specifier/version lines.
      if (!new RegExp(`^\\s{2,10}${pkg}:\\s*$`, 'u').test(lines[index]!)) continue;
      const window = lines.slice(index + 1, index + 5).join('\n');
      // version may carry a peer-dependency suffix: `16.2.11(react@19.2.3)`.
      const resolved = window.match(/^\s+version:\s*(v?[0-9A-Za-z.-]+)/mu);
      if (!resolved) continue;
      const version = parseVersion(resolved[1]!);
      if (!version) continue;
      found.push({
        name: framework,
        version: formatVersion(version),
        tier: 'lockfile',
        file,
        line: index + 2,
      });
      break;
    }
  }
  return found;
}

function yarnLockCandidates(file: EvidenceFile): Candidate[] {
  const text = file.bytes.toString('utf8');
  if (!/^# THIS IS AN AUTOGENERATED FILE/mu.test(text) && !/^__metadata:/mu.test(text)) return [];
  const lines = text.split('\n');
  const found: Candidate[] = [];
  for (const pkg of Object.keys(FRAMEWORK_PACKAGES).filter((name) => !name.includes('/'))) {
    const framework = FRAMEWORK_PACKAGES[pkg]!;
    for (let index = 0; index < lines.length; index += 1) {
      if (!new RegExp(`^"?${pkg}(@|,|:)",?.*:\\s*$`, 'u').test(lines[index]!)) continue;
      const window = lines.slice(index + 1, index + 6).join('\n');
      const resolved = window.match(/^\s+version\s+"?([^"\s]+)"?/mu);
      if (!resolved) continue;
      const version = parseVersion(resolved[1]!.replace(/^v/u, ''));
      if (!version) continue;
      found.push({
        name: framework,
        version: formatVersion(version),
        tier: 'lockfile',
        file,
        line: index + 2,
      });
      break;
    }
  }
  return found;
}

function importCandidates(files: ReadonlyMap<string, Buffer>): Candidate[] {
  const found: Candidate[] = [];
  for (const pkg of Object.keys(FRAMEWORK_PACKAGES).filter((name) => !name.includes('/'))) {
    const framework = FRAMEWORK_PACKAGES[pkg]!;
    const pattern = new RegExp(
      `(?:import|export|require)\\b[^\\n]{0,160}['"]${pkg}(?:\\/[^'"]*)?['"]`,
      'u',
    );
    // First match in path order is the deterministic anchor.
    for (const path of [...files.keys()].sort(codepointCompare)) {
      const lines = files.get(path)!.toString('utf8').split('\n');
      const line = lines.findIndex((text) => pattern.test(text));
      if (line === -1) continue;
      found.push({
        name: framework,
        tier: 'imports',
        file: { path, bytes: files.get(path)! },
        line: line + 1,
      });
      break;
    }
  }
  return found;
}

function parseWaivers(
  file: EvidenceFile | undefined,
  repository: string,
  commit: string,
): { waivers: FrameworkWaiver[]; diagnostics: Diagnostic[] } {
  if (!file) return { waivers: [], diagnostics: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.bytes.toString('utf8'));
  } catch {
    return {
      waivers: [],
      diagnostics: [
        rulesDiagnostic(
          ARXIC_RULES_WAIVER_INVALID,
          WAIVER_PATH,
          'arxic.waivers.json is not valid JSON; every waiver is ignored (fail closed)',
        ),
      ],
    };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return {
      waivers: [],
      diagnostics: [
        rulesDiagnostic(
          ARXIC_RULES_WAIVER_INVALID,
          WAIVER_PATH,
          'arxic.waivers.json must be an object',
        ),
      ],
    };
  }
  const entries = (parsed as Record<string, unknown>).frameworkWaivers;
  if (entries === undefined) return { waivers: [], diagnostics: [] };
  if (!Array.isArray(entries)) {
    return {
      waivers: [],
      diagnostics: [
        rulesDiagnostic(
          ARXIC_RULES_WAIVER_INVALID,
          WAIVER_PATH,
          'frameworkWaivers must be an array',
        ),
      ],
    };
  }
  const waivers: FrameworkWaiver[] = [];
  const diagnostics: Diagnostic[] = [];
  entries.forEach((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      diagnostics.push(
        rulesDiagnostic(
          ARXIC_RULES_WAIVER_INVALID,
          WAIVER_PATH,
          `frameworkWaivers[${index}] must be an object`,
        ),
      );
      return;
    }
    const record = entry as Record<string, unknown>;
    const strings = [
      'framework',
      'version',
      'packVersionRange',
      'reason',
      'approvedBy',
      'recordedAt',
    ] as const;
    const values: Record<string, string> = {};
    for (const key of strings) {
      const value = record[key];
      if (typeof value !== 'string' || value.trim() === '') {
        diagnostics.push(
          rulesDiagnostic(
            ARXIC_RULES_WAIVER_INVALID,
            WAIVER_PATH,
            `frameworkWaivers[${index}].${key} must be a non-empty string; the waiver is ignored`,
          ),
        );
        return;
      }
      values[key] = value.trim();
    }
    if (!parseVersion(values.version!)) {
      diagnostics.push(
        rulesDiagnostic(
          ARXIC_RULES_WAIVER_INVALID,
          WAIVER_PATH,
          `frameworkWaivers[${index}].version is not a semantic version; the waiver is ignored`,
        ),
      );
      return;
    }
    if (!parseRange(values.packVersionRange!)) {
      diagnostics.push(
        rulesDiagnostic(
          ARXIC_RULES_WAIVER_INVALID,
          WAIVER_PATH,
          `frameworkWaivers[${index}].packVersionRange is outside the supported range grammar; the waiver is ignored`,
        ),
      );
      return;
    }
    if (Number.isNaN(Date.parse(values.recordedAt!))) {
      diagnostics.push(
        rulesDiagnostic(
          ARXIC_RULES_WAIVER_INVALID,
          WAIVER_PATH,
          `frameworkWaivers[${index}].recordedAt is not an ISO-8601 timestamp; the waiver is ignored`,
        ),
      );
      return;
    }
    const line = lineOf(file.bytes, `"framework": "${values.framework}"`) ?? 1;
    waivers.push({
      framework: values.framework!,
      version: values.version!,
      packVersionRange: values.packVersionRange!,
      reason: values.reason!,
      approvedBy: values.approvedBy!,
      recordedAt: values.recordedAt!,
      evidence: evidenceRef(
        file,
        line,
        repository,
        commit,
        `framework-waiver:${values.framework}@${values.version}`,
      ),
    });
  });
  return { waivers, diagnostics };
}

/**
 * Deterministic framework+version detection over a source root. Manifests and
 * lockfiles are read from a fixed candidate-path list through the safe-source
 * rail; import evidence is taken from tracked TypeScript files (optionally the
 * already-read `sourceBytes` map, as the scan path provides).
 */
export async function detectFrameworkEvidence(input: {
  root: string;
  repository: string;
  commit: string;
  sourceBytes?: ReadonlyMap<string, Buffer>;
}): Promise<FrameworkDetection> {
  const tierOrder: Record<FrameworkEvidenceTier, number> = { lockfile: 0, manifest: 1, imports: 2 };
  const candidates: Candidate[] = [];
  const lockfiles: EvidenceFile[] = [];
  const manifests: EvidenceFile[] = [];
  let waiverFile: EvidenceFile | undefined;
  for (const path of [...LOCKFILE_PATHS, ...MANIFEST_PATHS, WAIVER_PATH]) {
    const read = await readSafeSource(input.root, path, EVIDENCE_MAX_BYTES);
    if (!read.ok) continue;
    const file: EvidenceFile = { path, bytes: read.bytes };
    if (path === WAIVER_PATH) waiverFile = file;
    else if ((LOCKFILE_PATHS as readonly string[]).includes(path)) lockfiles.push(file);
    else manifests.push(file);
  }
  for (const file of lockfiles) {
    if (file.path === 'pnpm-lock.yaml') candidates.push(...pnpmLockCandidates(file));
    else if (file.path === 'yarn.lock') candidates.push(...yarnLockCandidates(file));
    else candidates.push(...jsonLockCandidates(file, file.path));
  }
  for (const file of manifests) {
    if (file.path === 'package.json') candidates.push(...nodeManifestCandidates(file));
    else candidates.push(...composerManifestCandidates(file));
  }
  const sourceBytes = input.sourceBytes ?? (await trackedSourceBytes(input.root));
  candidates.push(...importCandidates(sourceBytes));

  const frameworks: DetectedFramework[] = [];
  const names = [...new Set(candidates.map((candidate) => candidate.name))].sort(codepointCompare);
  for (const name of names) {
    const forFramework = candidates
      .filter((candidate) => candidate.name === name)
      .sort(
        (left, right) =>
          tierOrder[left.tier] - tierOrder[right.tier] ||
          codepointCompare(left.file.path, right.file.path),
      );
    const best = forFramework[0]!;
    const bestTier = forFramework.filter((candidate) => candidate.tier === best.tier);
    const lockfileEvidence = bestTier.find((candidate) => candidate.version !== undefined);
    const chosen = lockfileEvidence ?? best;
    const evidence = forFramework
      .slice(0, 4)
      .map((candidate) =>
        evidenceRef(
          candidate.file,
          candidate.line,
          input.repository,
          input.commit,
          `framework-evidence:${name}${candidate.version ? `@${candidate.version}` : ''}`,
        ),
      );
    frameworks.push({
      name,
      ...(chosen.version ? { version: chosen.version } : {}),
      ...(chosen.declaredRange ? { declaredRange: chosen.declaredRange } : {}),
      tier: chosen.tier,
      evidence,
    });
  }
  const { waivers, diagnostics } = parseWaivers(waiverFile, input.repository, input.commit);
  return { frameworks, waivers, waiverDiagnostics: diagnostics };
}

// ---------------------------------------------------------------------------
// Enforcement
// ---------------------------------------------------------------------------

export type FrameworkVerdict = 'accepted' | 'rejected' | 'waived' | 'unknown' | 'undetected';

export type FrameworkGateResult = {
  verdicts: Array<{
    framework: string;
    packId: string;
    verdict: FrameworkVerdict;
    detectedVersion?: string;
    tier?: FrameworkEvidenceTier;
  }>;
  diagnostics: Diagnostic[];
  runRules: boolean;
};

function appliesTo(
  waiver: FrameworkWaiver,
  framework: string,
  version: string | undefined,
  pack: LoadedPack,
): boolean {
  return (
    waiver.framework === framework &&
    version !== undefined &&
    waiver.version === version &&
    waiver.packVersionRange === pack.framework.versions
  );
}

/**
 * Normative range enforcement at rulepack selection time. Every requested
 * framework must be provided by an installed pack (unknown frameworks block
 * here rather than falling through name-only matching), and the detected
 * version — or, for manifest ranges, every installable version — must lie
 * inside the pack's declared range. Only a recorded waiver overrides a
 * rejection.
 */
export function evaluateFrameworkGate(input: {
  frameworks: readonly string[];
  packs: readonly LoadedPack[];
  detection: FrameworkDetection;
}): FrameworkGateResult {
  const verdicts: FrameworkGateResult['verdicts'] = [];
  const diagnostics: Diagnostic[] = [...input.detection.waiverDiagnostics];
  const available = [...new Set(input.packs.map((pack) => pack.framework.name))].sort(
    codepointCompare,
  );
  for (const framework of input.frameworks) {
    const matching = input.packs.filter((pack) => pack.framework.name === framework);
    if (matching.length === 0) {
      diagnostics.push(
        rulesDiagnostic(
          ARXIC_RULES_FRAMEWORK_UNKNOWN,
          `framework:${framework}`,
          `framework '${framework}' has no installed rulepack (available: ${
            available.length > 0 ? available.join(', ') : 'none'
          }); no rules can run`,
        ),
      );
      verdicts.push({ framework, packId: '', verdict: 'unknown' });
      continue;
    }
    const detected = input.detection.frameworks.find((entry) => entry.name === framework);
    for (const pack of matching) {
      const rangeText = pack.framework.versions;
      if (!detected) {
        diagnostics.push(
          rulesDiagnostic(
            ARXIC_RULES_FRAMEWORK_UNDETECTED,
            `framework:${framework}`,
            `no version evidence for '${framework}' (lockfiles, manifests, or imports); pack ${pack.id}@${pack.version} rules run without range enforcement`,
            'observed',
          ),
        );
        verdicts.push({ framework, packId: pack.id, verdict: 'undetected' });
        continue;
      }
      const base = {
        framework,
        packId: pack.id,
        ...(detected.version ? { detectedVersion: detected.version } : {}),
        tier: detected.tier,
      };
      if (detected.version) {
        const version = parseVersion(detected.version);
        const range = parseRange(rangeText);
        const satisfied = version && range && versionSatisfies(version, range);
        if (satisfied) {
          diagnostics.push(
            rulesDiagnostic(
              ARXIC_RULES_FRAMEWORK_ACCEPTED,
              `framework:${framework}`,
              `framework '${framework}' ${detected.version} (${detected.tier} evidence) is inside pack ${pack.id}@${pack.version} range ${rangeText}`,
              'observed',
            ),
          );
          verdicts.push({ ...base, verdict: 'accepted' });
          continue;
        }
        const waiver = input.detection.waivers.find((entry) =>
          appliesTo(entry, framework, detected.version, pack),
        );
        if (waiver) {
          diagnostics.push(
            rulesDiagnostic(
              ARXIC_RULES_FRAMEWORK_WAIVED,
              `framework:${framework}`,
              `operator ${waiver.approvedBy} waived '${framework}' ${detected.version} against pack ${pack.id}@${pack.version} range ${rangeText}: ${waiver.reason} (recorded ${waiver.recordedAt})`,
              'observed',
            ),
          );
          verdicts.push({ ...base, verdict: 'waived' });
          continue;
        }
        diagnostics.push(
          rulesDiagnostic(
            ARXIC_RULES_FRAMEWORK_REJECTED,
            `framework:${framework}`,
            `framework '${framework}' ${detected.version} (${detected.tier} evidence) is outside pack ${pack.id}@${pack.version} range ${rangeText}; record a waiver in arxic.waivers.json to override deliberately`,
          ),
        );
        verdicts.push({ ...base, verdict: 'rejected' });
        continue;
      }
      if (detected.declaredRange) {
        const declared = parseRange(detected.declaredRange);
        const range = parseRange(rangeText);
        const contained = declared && range && intervalContains(range, declared);
        if (contained) {
          diagnostics.push(
            rulesDiagnostic(
              ARXIC_RULES_FRAMEWORK_ACCEPTED,
              `framework:${framework}`,
              `declared ${detected.tier} range ${detected.declaredRange} for '${framework}' installs only versions inside pack ${pack.id}@${pack.version} range ${rangeText}`,
              'observed',
            ),
          );
          verdicts.push({ ...base, verdict: 'accepted' });
          continue;
        }
        diagnostics.push(
          rulesDiagnostic(
            ARXIC_RULES_FRAMEWORK_REJECTED,
            `framework:${framework}`,
            `declared ${detected.tier} range ${detected.declaredRange} for '${framework}' can install versions outside pack ${pack.id}@${pack.version} range ${rangeText}; record a waiver in arxic.waivers.json to override deliberately`,
          ),
        );
        verdicts.push({ ...base, verdict: 'rejected' });
        continue;
      }
      diagnostics.push(
        rulesDiagnostic(
          ARXIC_RULES_FRAMEWORK_UNDETECTED,
          `framework:${framework}`,
          `only ${detected.tier}-tier name evidence for '${framework}' (no version, no declared range); pack ${pack.id}@${pack.version} rules run without range enforcement`,
          'observed',
        ),
      );
      verdicts.push({ ...base, verdict: 'undetected' });
    }
  }
  return {
    verdicts,
    diagnostics,
    runRules: !diagnostics.some((diagnostic) => diagnostic.severity === 'blocked'),
  };
}

/** Evidence refs backing the gate verdicts: per requested framework, the
 * detection evidence plus the evidence of any waiver that applied. */
export function frameworkGateEvidence(input: {
  frameworks: readonly string[];
  detection: FrameworkDetection;
  verdicts: FrameworkGateResult['verdicts'];
}): EvidenceRefSource[] {
  const refs: EvidenceRefSource[] = [];
  for (const framework of input.frameworks) {
    const detected = input.detection.frameworks.find((entry) => entry.name === framework);
    if (detected) refs.push(...detected.evidence);
  }
  for (const verdict of input.verdicts) {
    if (verdict.verdict !== 'waived' || verdict.detectedVersion === undefined) continue;
    const waiver = input.detection.waivers.find(
      (entry) => entry.framework === verdict.framework && entry.version === verdict.detectedVersion,
    );
    if (waiver) refs.push(waiver.evidence);
  }
  return refs;
}
