import { describe, expect, it } from 'vitest';
import { classifyStateText, runtimeStateMap, type RouteCoverage } from '../route-coverage';

/**
 * Runtime state mapping (refs #402): the pure fusion of source-declared state
 * dimensions with runtime-observed rendered markers. Every cell of the
 * truth table is pinned; the vocabulary is shared with the source tier.
 */
const route = (
  path: string,
  dimensions: Partial<Record<string, 'referenced' | 'absent'>> = {},
): RouteCoverage => ({
  method: 'GET',
  path,
  files: [`app${path}/page.tsx`],
  dimensions: ['state:loading', 'state:error', 'state:empty', 'actions', 'tests', 'docs'].map(
    (name) => ({
      name: name as RouteCoverage['dimensions'][number]['name'],
      status: dimensions[name] ?? 'absent',
      evidence: [],
    }),
  ),
});

describe('runtimeStateMap truth table', () => {
  it('maps every declared/observed combination per state dimension', () => {
    const coverage = [
      route('/both', { 'state:loading': 'referenced' }),
      route('/declared-only', { 'state:empty': 'referenced' }),
      route('/neither'),
    ];
    const runtime = [
      { path: '/both', states: ['state:loading'] },
      { path: '/declared-only', states: [] },
      { path: '/neither', states: [] },
      { path: '/runtime-only', states: ['state:error'] },
    ];
    const mapping = runtimeStateMap(coverage, runtime);
    const cell = (path: string, name: string) =>
      mapping
        .find((entry) => entry.path === path)
        ?.dimensions.find((dimension) => dimension.name === name)?.mapping;
    expect(cell('/both', 'state:loading')).toBe('declared-and-observed');
    expect(cell('/declared-only', 'state:empty')).toBe('declared-unobserved');
    expect(cell('/runtime-only', 'state:error')).toBe('observed-undeclared');
    expect(cell('/neither', 'state:error')).toBe('unobserved-undeclared');
    // A route observed but absent from the source inventory maps fully.
    expect(cell('/runtime-only', 'state:loading')).toBe('unobserved-undeclared');
    // Non-state dimensions never appear in the runtime mapping.
    expect(mapping[0]?.dimensions.map(({ name }) => name)).toEqual([
      'state:loading',
      'state:error',
      'state:empty',
    ]);
    // Stable ordering and pure derivation.
    expect(mapping.map(({ path }) => path)).toEqual(
      ['/both', '/declared-only', '/neither', '/runtime-only'].sort((left, right) =>
        left.localeCompare(right),
      ),
    );
    expect(runtimeStateMap(coverage, runtime)).toEqual(mapping);
  });

  it('classifies rendered marker text with the source-tier vocabulary', () => {
    expect(classifyStateText('Inbox is empty')).toEqual(['state:empty']);
    expect(classifyStateText('Loading failed — retry')).toEqual(['state:loading', 'state:error']);
    expect(classifyStateText('Welcome back')).toEqual([]);
    expect(classifyStateText('spinner aria-busy')).toContain('state:loading');
  });
});
