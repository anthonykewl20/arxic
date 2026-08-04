import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { POLICY, classifyPackage } from './license-policy.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

function loadGraph(from) {
  const json = from
    ? readFileSync(resolve(process.cwd(), from), 'utf8')
    : execFileSync('pnpm', ['licenses', 'list', '--json'], {
        cwd: root,
        encoding: 'utf8',
      });
  return JSON.parse(json);
}

function findVendoredSource() {
  const directory = resolve(root, 'third_party');
  try {
    return readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => !/^(?:README|LICENSE|PROVENANCE)(?:\.[^.]+)?$/iu.test(name));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export function evaluateGraph(graph) {
  const packages = Object.entries(graph).flatMap(([license, entries]) =>
    entries.map((entry) => ({ name: entry.name, license })),
  );
  const allowed = [];
  const excepted = [];
  const rejected = [];
  for (const pkg of packages) {
    const result = classifyPackage(pkg);
    const record = { ...pkg, reason: result.reason };
    if (result.disposition === 'rejected') rejected.push(record);
    else if (result.reason.startsWith('Exception (')) excepted.push(record);
    else allowed.push(record);
  }
  return { total: packages.length, allowed, excepted, rejected };
}

export function runGate({ from } = {}) {
  const result = evaluateGraph(loadGraph(from));
  const vendoredSource = findVendoredSource();
  for (const name of vendoredSource) {
    result.rejected.push({
      name: `third_party/${name}`,
      license: 'vendored source',
      reason: 'Vendored code requires an upstream license and commit record (ADR §18).',
    });
  }
  console.log('License gate');
  console.log(`Policy: ${POLICY}`);
  console.log(`Total packages: ${result.total}`);
  console.log(`Allowed: ${result.allowed.length}`);
  console.log(`Excepted: ${result.excepted.length}`);
  for (const pkg of result.excepted) {
    console.log(`  ${pkg.name} → ${pkg.license} → ${pkg.reason}`);
  }
  console.log(`Rejected: ${result.rejected.length}`);
  for (const pkg of result.rejected) {
    console.log(`  ${pkg.name} → ${pkg.license} → ${pkg.reason}`);
  }
  return result;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const fromIndex = process.argv.indexOf('--from');
  if (fromIndex !== -1 && !process.argv[fromIndex + 1]) {
    console.error('--from requires a file path');
    process.exitCode = 1;
  } else {
    const result = runGate({ from: fromIndex === -1 ? undefined : process.argv[fromIndex + 1] });
    process.exitCode = result.rejected.length === 0 ? 0 : 1;
  }
}
