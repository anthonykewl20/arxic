import { describe, expect, it } from 'vitest';

import {
  defaultSkillsDir,
  evaluateSkills,
  lintSkill,
  lintSkillContent,
  parseSkillFile,
} from './skills-gate.mjs';

const knownSkills = new Set(['well-formed', 'remind']);
const validDescription = 'Checks skill structure. Use when validating a skill catalog.';
const validFrontmatter = (name = 'well-formed') => ({
  name,
  description: validDescription,
});

describe('skill gate sad paths', () => {
  it.each([
    {
      code: 'E1',
      evaluate: () => lintSkill('missing-skill', '/path/that/does/not/exist', knownSkills),
    },
    {
      code: 'E2',
      evaluate: () => parseSkillFile('broken-yaml', '---\nname: [\n---\nbody'),
    },
    {
      code: 'E3',
      evaluate: () =>
        lintSkillContent(
          'well-formed',
          { ...validFrontmatter(), name: 'different-name' },
          '',
          knownSkills,
        ),
    },
    {
      code: 'E4',
      evaluate: () => lintSkillContent('Not_Kebab', validFrontmatter('Not_Kebab'), '', knownSkills),
    },
    {
      code: 'E5',
      evaluate: () =>
        lintSkillContent(
          'well-formed',
          { ...validFrontmatter(), description: `Use when validating. ${'x'.repeat(2000)}` },
          '',
          knownSkills,
        ),
    },
    {
      code: 'E6',
      evaluate: () =>
        lintSkillContent(
          'well-formed',
          { ...validFrontmatter(), description: 'Do not use when validating skills.' },
          '',
          knownSkills,
        ),
    },
    {
      code: 'E7',
      evaluate: () =>
        lintSkillContent(
          'well-formed',
          { ...validFrontmatter(), exempt: 'sections' },
          '',
          knownSkills,
        ),
    },
  ])('$code blocks malformed skill input', ({ code, evaluate }) => {
    const result = evaluate();
    const errorCodes =
      result.errors?.map((error) => error.slice(0, 2)) ?? (result.parseError ? ['E2'] : []);
    expect(errorCodes).toContain(code);
  });

  it.each([
    ['missing', 'body without frontmatter', /missing yaml frontmatter/i],
    ['unparseable', '---\nname: [\n---\nbody', /flow sequence|unexpected/i],
  ])('reports %s frontmatter with parser detail', (_case, content, message) => {
    const result = parseSkillFile('broken-yaml', content);
    expect(result.frontmatter).toBeNull();
    expect(result.parseError).toMatch(message);
  });

  it.each([
    ['a missing name', { description: validDescription }],
    ['an empty name', { name: '', description: validDescription }],
  ])('rejects E3 for %s', (_case, frontmatter) => {
    const result = lintSkillContent('well-formed', frontmatter, '', knownSkills);
    expect(result.errors.some((error) => error.startsWith('E3'))).toBe(true);
  });

  it.each([
    ['a missing description', { name: 'well-formed' }],
    ['an empty description', { name: 'well-formed', description: '  ' }],
  ])('rejects E5 for %s', (_case, frontmatter) => {
    const result = lintSkillContent('well-formed', frontmatter, '', knownSkills);
    expect(result.errors.some((error) => error.startsWith('E5'))).toBe(true);
  });

  it('rejects a bare command skill without a trigger exemption', () => {
    const result = lintSkillContent(
      'well-formed',
      { ...validFrontmatter(), description: 'Rewrite the previous response.' },
      '',
      knownSkills,
    );
    expect(result.errors.some((error) => error.startsWith('E6'))).toBe(true);
    expect(result.warnings.some((warning) => warning.startsWith('W2'))).toBe(true);
  });

  it('rejects an adverbially-separated negation as E6 (no affirmative trigger)', () => {
    // "Do not ever use when X." must NOT satisfy the trigger: the negation owns the clause,
    // even though an adverb separates "do not" from "use". Pins the NEGATED_TRIGGER strip.
    const result = lintSkillContent(
      'well-formed',
      { ...validFrontmatter(), description: 'Do not ever use when validating skills.' },
      '',
      knownSkills,
    );
    expect(result.errors.some((error) => error.startsWith('E6'))).toBe(true);
  });
});

describe('skill gate allowed paths', () => {
  it('accepts a well-formed skill', () => {
    const result = lintSkillContent(
      'well-formed',
      validFrontmatter(),
      '## Overview\n\nUseful details.',
      knownSkills,
    );
    expect(result.errors).toEqual([]);
  });

  it('parses folded YAML descriptions and preserves extra fields', () => {
    const result = parseSkillFile(
      'well-formed',
      '---\nname: well-formed\ndescription: >\n  Checks skills. Use whenever a catalog changes.\ncompatibility: Node\nmetadata:\n  version: "1.0"\n---\n## Overview\n',
    );
    expect(result).toMatchObject({
      frontmatter: {
        name: 'well-formed',
        description: 'Checks skills. Use whenever a catalog changes.\n',
        compatibility: 'Node',
        metadata: { version: '1.0' },
      },
      body: '## Overview\n',
    });
  });

  it('allows a manual command with disable-model-invocation and no trigger', () => {
    const result = lintSkillContent(
      'remind',
      {
        name: 'remind',
        description: 'Rewrite the previous response.',
        'disable-model-invocation': true,
      },
      '',
      knownSkills,
    );
    expect(result.errors).toEqual([]);
    expect(result.exempt).toBe(true);
  });

  it('warns about an unknown cross-skill reference', () => {
    const result = lintSkillContent(
      'well-formed',
      validFrontmatter(),
      '## Overview\n\nUse the `nonexistent` skill next.',
      knownSkills,
    );
    expect(result.warnings).toContain(
      'W1 Dead cross-reference: `nonexistent` is not a known skill',
    );
  });

  it('does not count an Overview heading inside a fenced example', () => {
    const result = lintSkillContent(
      'well-formed',
      validFrontmatter(),
      '```markdown\n## Overview\n```',
      knownSkills,
    );
    expect(result.warnings).toContain('Section advisory: missing ## Overview');
  });
});

describe('integration: real arxic skills on disk', () => {
  it('passes all four current Arxic skills with zero errors', () => {
    const result = evaluateSkills(defaultSkillsDir);
    expect(result.total).toBe(4);
    expect(result.errors).toBe(0);
    expect(result.warnings).toBe(3);
    expect(result.skills.map(({ name }) => name)).toEqual([
      'code-structure',
      'evidence-driven-testing',
      'global-agent-guardrails',
      'remind',
    ]);
  });
});
