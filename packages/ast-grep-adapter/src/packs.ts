import { readdir, readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { ARXIC_RULES_CONFLICT, ARXIC_RULES_PACK_INVALID, rulesDiagnostic } from './diagnostics';
import type { Diagnostic } from '@arxic/contracts';

export const RULE_CATEGORIES = [
  'route',
  'form',
  'handler',
  'guard',
  'password-hash',
  'token-create',
  'token-persist',
  'token-verify',
  'mail-transport',
  'session-cookie',
  'totp-verify',
] as const;
export type RuleCategory = (typeof RULE_CATEGORIES)[number];

export type RuleMetadata = {
  id: string;
  category: RuleCategory;
  semver: string;
  frameworkVersions: string;
  precision: string;
  fallback: string;
  license: string;
  provenance: string;
  file: string;
  packId: string;
  packVersion: string;
};

export type LoadedPack = {
  id: string;
  version: string;
  framework: { name: string; versions: string };
  license: string;
  provenance: string;
  ruleDir: string;
  directory: string;
  rules: RuleMetadata[];
};

export type PackLoadResult = {
  packs: LoadedPack[];
  rules: RuleMetadata[];
  diagnostics: Diagnostic[];
};

const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const scalar = (text: string, name: string) => {
  const match = text.match(new RegExp(`^\\s{4}${name}:\\s*["']?([^\\n"']+)["']?\\s*$`, 'mu'));
  return match?.[1]?.trim();
};

async function loadPack(directory: string): Promise<LoadedPack> {
  const json = JSON.parse(await readFile(join(directory, 'pack.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  const framework = json.framework as Record<string, unknown> | undefined;
  if (
    typeof json.id !== 'string' ||
    typeof json.version !== 'string' ||
    !semver.test(json.version) ||
    typeof framework?.name !== 'string' ||
    typeof framework.versions !== 'string' ||
    typeof json.license !== 'string' ||
    typeof json.provenance !== 'string' ||
    typeof json.ruleDir !== 'string'
  )
    throw new Error('pack.json is missing a required field or valid semantic version');
  const ruleDirectory = resolve(directory, json.ruleDir);
  const relativeRuleDirectory = relative(directory, ruleDirectory);
  if (relativeRuleDirectory.startsWith('..') || isAbsolute(relativeRuleDirectory))
    throw new Error('ruleDir must remain inside the pack directory');
  const files = (await readdir(ruleDirectory)).filter((name) => /\.ya?ml$/u.test(name)).sort();
  if (files.length === 0) throw new Error('ruleDir contains no YAML rules');
  const rules: RuleMetadata[] = [];
  for (const name of files) {
    const file = join(ruleDirectory, name);
    const text = await readFile(file, 'utf8');
    const id = text.match(/^id:\s*([A-Za-z0-9_-]+)\s*$/mu)?.[1];
    const category = scalar(text, 'category');
    const version = scalar(text, 'semver');
    const metadata = {
      frameworkVersions: scalar(text, 'frameworkVersions'),
      precision: scalar(text, 'precision'),
      fallback: scalar(text, 'fallback'),
      license: scalar(text, 'license'),
      provenance: scalar(text, 'provenance'),
    };
    if (
      !id ||
      !RULE_CATEGORIES.includes(category as RuleCategory) ||
      !version ||
      !semver.test(version) ||
      Object.values(metadata).some((value) => !value)
    ) {
      throw new Error(`${name} has malformed metadata.arxic`);
    }
    rules.push({
      id,
      category: category as RuleCategory,
      semver: version,
      frameworkVersions: metadata.frameworkVersions!,
      precision: metadata.precision!,
      fallback: metadata.fallback!,
      license: metadata.license!,
      provenance: metadata.provenance!,
      file,
      packId: json.id,
      packVersion: json.version,
    });
  }
  return {
    id: json.id,
    version: json.version,
    framework: framework as LoadedPack['framework'],
    license: json.license,
    provenance: json.provenance,
    ruleDir: ruleDirectory,
    directory,
    rules,
  };
}

export async function loadPacks(directories: string[]): Promise<PackLoadResult> {
  const packs: LoadedPack[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const directory of [...directories].sort()) {
    try {
      packs.push(await loadPack(resolve(directory)));
    } catch (error) {
      diagnostics.push(
        rulesDiagnostic(
          ARXIC_RULES_PACK_INVALID,
          directory,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  }
  const grouped = new Map<string, RuleMetadata[]>();
  for (const rule of packs.flatMap((pack) => pack.rules))
    grouped.set(rule.id, [...(grouped.get(rule.id) ?? []), rule]);
  const conflicts = new Set<string>();
  for (const [id, definitions] of grouped) {
    if (definitions.length < 2) continue;
    conflicts.add(id);
    const owners = definitions.map((rule) => `${rule.packId}@${rule.packVersion}`).sort();
    diagnostics.push(
      rulesDiagnostic(
        ARXIC_RULES_CONFLICT,
        id,
        `Rule ${id} conflicts between ${owners.join(', ')}`,
      ),
    );
  }
  return {
    packs,
    rules: packs.flatMap((pack) => pack.rules).filter((rule) => !conflicts.has(rule.id)),
    diagnostics,
  };
}
