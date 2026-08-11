import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const root = fileURLToPath(new URL('..', import.meta.url));
export const defaultSkillsDir = resolve(root, '.opencode/skills');

const MAX_DESCRIPTION_LENGTH = 1024;
const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DESCRIPTION_TRIGGER = /\buse (?:this )?(?:when|whenever|before|after|during)\b/iu;
const NEGATED_TRIGGER =
  /\b(?:do not|don't|never)(?:\s+\w+){0,2}\s+use (?:this )?(?:when|whenever|before|after|during)\b/giu;
const BARE_COMMAND =
  /^(?:add|analyze|apply|check|create|debug|design|document|fix|implement|record|review|rewrite|run|test|validate|verify)\b/iu;

// Exemptions stay validator-owned so a skill cannot weaken its own validation contract.
const EXEMPT_SKILLS = {
  remind:
    'Manual slash command: disable-model-invocation prevents model routing, so a description trigger is not applicable.',
};

const SKILL_REF_PATTERNS = [
  /\buse the `([a-z][a-z0-9-]*[a-z0-9])` skill/giu,
  /\bfollow the `([a-z][a-z0-9-]*[a-z0-9])` skill/giu,
  /`([a-z][a-z0-9-]*[a-z0-9])` skill\b/giu,
];

function stripFencedCodeBlocks(content) {
  return content.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gmu, '');
}

function skillReferences(content) {
  const references = new Set();
  const prose = stripFencedCodeBlocks(content);
  for (const pattern of SKILL_REF_PATTERNS) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(prose); match; match = pattern.exec(prose)) {
      references.add(match[1]);
    }
  }
  return references;
}

export function parseSkillFile(dirName, content) {
  const match = content.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/u);
  if (!match) {
    return {
      frontmatter: null,
      body: content,
      parseError: `Missing YAML frontmatter in '${dirName}' (expected a --- block at the start)`,
    };
  }

  const body = content.slice(match[0].length);
  try {
    const frontmatter = parse(match[1]);
    if (frontmatter === null || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
      return {
        frontmatter: null,
        body,
        parseError: `YAML frontmatter in '${dirName}' must be a mapping`,
      };
    }
    return { frontmatter, body };
  } catch (error) {
    return {
      frontmatter: null,
      body,
      parseError: `Unparseable YAML frontmatter in '${dirName}': ${error.message}`,
    };
  }
}

export function lintSkillContent(dirName, frontmatter, body, knownSkills) {
  const errors = [];
  const warnings = [];
  const validatorExempt = Object.hasOwn(EXEMPT_SKILLS, dirName);
  const invocationExempt = frontmatter?.['disable-model-invocation'] === true;
  const exempt = validatorExempt || invocationExempt;

  if (frontmatter === null || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    errors.push('E2 Missing or unparseable YAML frontmatter');
    return { errors, warnings, exempt };
  }

  if (typeof frontmatter.name !== 'string' || frontmatter.name.length === 0) {
    errors.push("E3 Frontmatter missing required field: 'name'");
  } else if (frontmatter.name !== dirName) {
    errors.push(
      `E3 Frontmatter name '${frontmatter.name}' does not match directory name '${dirName}'`,
    );
  }

  if (!KEBAB_CASE.test(dirName)) {
    errors.push(`E4 Directory name '${dirName}' is not kebab-case`);
  }

  const description = frontmatter.description;
  if (typeof description !== 'string' || description.trim().length === 0) {
    errors.push("E5 Frontmatter missing non-empty required field: 'description'");
  } else {
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      errors.push(
        `E5 Description is ${description.length} chars and exceeds the ${MAX_DESCRIPTION_LENGTH}-char limit`,
      );
    }

    const affirmativeDescription = description.replaceAll(NEGATED_TRIGGER, '');
    if (!DESCRIPTION_TRIGGER.test(affirmativeDescription) && !exempt) {
      errors.push(
        'E6 Description has no affirmative trigger; add “Use when/whenever/before/after/during …”',
      );
      if (BARE_COMMAND.test(description.trim())) {
        warnings.push(
          'W2 Bare command description has no trigger; add one or set disable-model-invocation: true for a manual command',
        );
      }
    }
  }

  const declaresSelfExemption = Object.hasOwn(frontmatter, 'exempt') || frontmatter.type === 'meta';
  if (declaresSelfExemption && !validatorExempt) {
    errors.push(
      `E7 Frontmatter declares a self-exemption but '${dirName}' is not in the validator-owned exemption allowlist`,
    );
  }

  const prose = stripFencedCodeBlocks(body);
  if (!/^## Overview\s*$/mu.test(prose)) {
    warnings.push('Section advisory: missing ## Overview');
  }

  for (const reference of skillReferences(body)) {
    if (!knownSkills.has(reference)) {
      warnings.push(`W1 Dead cross-reference: \`${reference}\` is not a known skill`);
    }
  }

  return { errors, warnings, exempt };
}

export function lintSkill(dirName, skillsDir, knownSkills) {
  const skillPath = join(skillsDir, dirName, 'SKILL.md');
  if (!existsSync(skillPath)) {
    return { errors: ['E1 Missing SKILL.md'], warnings: [], exempt: false, missing: true };
  }

  let content;
  try {
    content = readFileSync(skillPath, 'utf8');
  } catch (error) {
    return {
      errors: [`E1 Unreadable SKILL.md: ${error.message}`],
      warnings: [],
      exempt: false,
    };
  }

  const parsed = parseSkillFile(dirName, content);
  if (parsed.parseError) {
    return {
      errors: [`E2 ${parsed.parseError}`],
      warnings: [],
      exempt: false,
    };
  }
  return lintSkillContent(dirName, parsed.frontmatter, parsed.body, knownSkills);
}

export function evaluateSkills(skillsDir) {
  const names = readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const knownSkills = new Set(names);
  const skills = names.map((name) => {
    const { errors, warnings, exempt } = lintSkill(name, skillsDir, knownSkills);
    return { name, errors, warnings, exempt };
  });
  return {
    total: skills.length,
    skills,
    errors: skills.reduce((total, skill) => total + skill.errors.length, 0),
    warnings: skills.reduce((total, skill) => total + skill.warnings.length, 0),
  };
}

export function runGate({ skillsDir = defaultSkillsDir } = {}) {
  const result = evaluateSkills(skillsDir);
  console.log('Skill eval gate — Tier 1');
  for (const skill of result.skills) {
    console.log(`${skill.errors.length === 0 ? '✓' : '✗'} ${skill.name}`);
    for (const error of skill.errors) console.log(`  ERROR: ${error}`);
    for (const warning of skill.warnings) console.log(`  WARNING: ${warning}`);
  }
  const status = result.errors === 0 ? 'PASSED' : 'FAILED';
  console.log(
    `${result.total} skills checked — ${result.errors} error(s), ${result.warnings} warning(s) — ${status}`,
  );
  return result;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const fromIndex = process.argv.indexOf('--from');
  if (fromIndex !== -1 && !process.argv[fromIndex + 1]) {
    console.error('--from requires a skills directory path');
    process.exitCode = 1;
  } else {
    const skillsDir = fromIndex === -1 ? defaultSkillsDir : resolve(process.argv[fromIndex + 1]);
    const result = runGate({ skillsDir });
    process.exitCode = result.errors > 0 ? 1 : 0;
  }
}
