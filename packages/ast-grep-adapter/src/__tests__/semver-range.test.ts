import { describe, expect, it } from 'vitest';
import { compareVersions, intervalContains, parseRange, parseVersion } from '../framework-gate';

describe('semver version parsing and ordering (real-world version shapes)', () => {
  it.each([
    ['16.2.6', '16.2.6', 0],
    ['16.2.6', '16.2.7', -1],
    ['16.2.6', '16.3.0', -1],
    ['16.2.6', '17.0.0', -1],
    ['15.0.0', '16.0.0', -1],
    ['16.2.6-canary.13', '16.2.6', -1],
    ['16.2.6-canary.13', '16.2.7', -1],
    ['16.0.0-rc.1', '16.0.0', -1],
    ['16.0.0-alpha.2', '16.0.0-alpha.10', -1],
    ['16.0.0-alpha', '16.0.0-alpha.1', -1],
    ['16.0.0-beta', '16.0.0-alpha', 1],
    ['5.1.0', '6.0.0', -1],
    ['13.24.0', '13.24.1', -1],
  ])('compareVersions(%s, %s) === %d', (left, right, expected) => {
    expect(compareVersions(parseVersion(left)!, parseVersion(right)!)).toBe(expected);
  });

  it('rejects non-semantic version strings deterministically', () => {
    // NOTE: a leading `v` IS accepted — composer tags versions as v13.24.0.
    for (const bad of ['latest', 'next', '', '16', '16.2', '16.2.x', '16.2.6.7'])
      expect(parseVersion(bad)).toBeUndefined();
  });

  it('strips leading v and ignores build metadata per semver precedence', () => {
    expect(parseVersion('v13.24.0')).toEqual(parseVersion('13.24.0+build.42'));
  });
});

describe('npm-grammar range parsing to intervals (subset used by packs and manifests)', () => {
  it('parses comparator lists as AND bounds', () => {
    expect(parseRange('>=15 <16')).toEqual([
      {
        min: { version: parseVersion('15.0.0')!, inclusive: true },
        max: { version: parseVersion('16.0.0')!, inclusive: false },
      },
    ]);
  });

  it('parses a bare exact version as an inclusive point interval', () => {
    expect(parseRange('16.2.6')).toEqual([
      {
        min: { version: parseVersion('16.2.6')!, inclusive: true },
        max: { version: parseVersion('16.2.6')!, inclusive: true },
      },
    ]);
  });

  it('parses caret ranges including the 0.x special cases from the npm spec', () => {
    expect(parseRange('^16.0.0')).toEqual([
      {
        min: { version: parseVersion('16.0.0')!, inclusive: true },
        max: { version: parseVersion('17.0.0')!, inclusive: false },
      },
    ]);
    expect(parseRange('^0.2.3')).toEqual([
      {
        min: { version: parseVersion('0.2.3')!, inclusive: true },
        max: { version: parseVersion('0.3.0')!, inclusive: false },
      },
    ]);
    expect(parseRange('^0.0.3')).toEqual([
      {
        min: { version: parseVersion('0.0.3')!, inclusive: true },
        max: { version: parseVersion('0.0.4')!, inclusive: false },
      },
    ]);
  });

  it('parses tilde ranges per the npm spec', () => {
    expect(parseRange('~5.1.0')).toEqual([
      {
        min: { version: parseVersion('5.1.0')!, inclusive: true },
        max: { version: parseVersion('5.2.0')!, inclusive: false },
      },
    ]);
    expect(parseRange('~16')).toEqual([
      {
        min: { version: parseVersion('16.0.0')!, inclusive: true },
        max: { version: parseVersion('17.0.0')!, inclusive: false },
      },
    ]);
  });

  it('parses x-ranges as wildcard intervals', () => {
    expect(parseRange('16')).toEqual(parseRange('16.x'));
    expect(parseRange('16.2')).toEqual([
      {
        min: { version: parseVersion('16.2.0')!, inclusive: true },
        max: { version: parseVersion('16.3.0')!, inclusive: false },
      },
    ]);
    expect(parseRange('*')).toEqual([{}]);
  });

  it('parses hyphen ranges with partial-end widening per the npm spec', () => {
    expect(parseRange('1.2.3 - 2.3')).toEqual([
      {
        min: { version: parseVersion('1.2.3')!, inclusive: true },
        max: { version: parseVersion('2.4.0')!, inclusive: false },
      },
    ]);
    expect(parseRange('1.2.3 - 2')).toEqual([
      {
        min: { version: parseVersion('1.2.3')!, inclusive: true },
        max: { version: parseVersion('3.0.0')!, inclusive: false },
      },
    ]);
  });

  it('parses OR unions as multiple intervals', () => {
    expect(parseRange('^15.0.0 || ^16.0.0')).toHaveLength(2);
  });

  it('returns undefined for ranges outside the supported grammar instead of guessing', () => {
    for (const bad of ['>=15 <', 'latest', '16.2.6 ||', 'node >= 22', ' >15 <16 <17 foo'])
      expect(parseRange(bad)).toBeUndefined();
  });
});

describe('interval containment (manifest range vs pack range)', () => {
  it('accepts a contained range and an exact pin', () => {
    expect(intervalContains(parseRange('>=4 <6')!, parseRange('^5.1.0')!)).toBe(true);
    expect(intervalContains(parseRange('>=15 <17')!, parseRange('16.3.0')!)).toBe(true);
    expect(intervalContains(parseRange('>=15 <17')!, parseRange('16.2.6')!)).toBe(true);
  });

  it('rejects the campaign shape: next 16.x against the historical >=15 <16 pack range', () => {
    expect(intervalContains(parseRange('>=15 <16')!, parseRange('16.2.6')!)).toBe(false);
    expect(intervalContains(parseRange('>=15 <16')!, parseRange('^16.0.0')!)).toBe(false);
    expect(intervalContains(parseRange('>=15 <16')!, parseRange('16')!)).toBe(false);
  });

  it('rejects overlapping-but-escaping ranges (fail closed, no partial credit)', () => {
    expect(intervalContains(parseRange('>=15 <16')!, parseRange('>=15.2 <17')!)).toBe(false);
    expect(intervalContains(parseRange('>=4 <6')!, parseRange('>=6.0.0')!)).toBe(false);
  });

  it('handles inclusive/exclusive boundary equality exactly', () => {
    expect(intervalContains(parseRange('>=15 <16')!, parseRange('>=15 <16')!)).toBe(true);
    expect(intervalContains(parseRange('>15')!, parseRange('>=15.0.0')!)).toBe(false);
    expect(intervalContains(parseRange('<16')!, parseRange('<16')!)).toBe(true);
    expect(intervalContains(parseRange('<=16.0.0')!, parseRange('16.0.0')!)).toBe(true);
  });

  it('applies the npm prerelease rule: prerelease points fail closed against release-only ranges', () => {
    expect(intervalContains(parseRange('>=15 <16')!, parseRange('16.0.0-rc.1')!)).toBe(false);
    // npm semantics: a prerelease only satisfies a range whose comparators carry a
    // prerelease on the same major.minor.patch tuple.
    expect(intervalContains(parseRange('>=15.0.0')!, parseRange('15.1.0-beta.2')!)).toBe(false);
    expect(intervalContains(parseRange('>=15.1.0-beta.1')!, parseRange('15.1.0-beta.2')!)).toBe(
      true,
    );
    expect(intervalContains(parseRange('>=15.1.0-alpha')!, parseRange('15.1.0-beta.2')!)).toBe(
      true,
    );
  });

  it('accepts OR-union candidates when every branch is contained', () => {
    expect(intervalContains(parseRange('>=15 <17')!, parseRange('^15.3.0 || ^16.2.0')!)).toBe(true);
    expect(intervalContains(parseRange('>=15 <16')!, parseRange('^15.3.0 || ^16.2.0')!)).toBe(
      false,
    );
  });
});
