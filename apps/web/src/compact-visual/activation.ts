import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256 } from '@arxic/contracts';

/**
 * Atomic model activation with known-good rollback (spec §14): artifacts are
 * content-addressed under `artifacts/<sha256>.bin`; activation validates the
 * content hash plus a caller-supplied gate (parity fixtures, manifest checks)
 * and only then flips the `active.json` pointer via write-tmp + rename so a
 * crash can never leave a half-active model. The prior known-good pointer is
 * kept in `previous.json` for rollback; failed or torn replacements leave the
 * active model untouched. This module never decides model quality — the
 * validation gate belongs to the caller.
 */
export type ModelPointer = { sha256: string; activatedAt: number };

const pointerPath = (modelsDir: string, name: string) => join(modelsDir, name);

export async function stageArtifact(modelsDir: string, bytes: Buffer): Promise<string> {
  await mkdir(join(modelsDir, 'artifacts'), { recursive: true, mode: 0o700 });
  const digest = sha256(bytes);
  await writeFile(join(modelsDir, 'artifacts', digest), bytes, { mode: 0o600, flag: 'wx' });
  return digest;
}

async function readPointer(modelsDir: string, name: string): Promise<ModelPointer | null> {
  try {
    const parsed = JSON.parse(await readFile(pointerPath(modelsDir, name), 'utf8')) as ModelPointer;
    if (typeof parsed.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(parsed.sha256)) return null;
    return parsed;
  } catch {
    return null; // absent or torn pointer: no active model of that name
  }
}

async function writePointerAtomic(modelsDir: string, name: string, pointer: ModelPointer) {
  const tmp = pointerPath(modelsDir, `${name}.tmp`);
  await writeFile(tmp, Buffer.from(JSON.stringify(pointer) + '\n'), { mode: 0o600, flag: 'w' });
  await rename(tmp, pointerPath(modelsDir, name));
}

export async function activateModel(
  modelsDir: string,
  sha: string,
  gate: { validate: (bytes: Buffer) => Promise<void> },
): Promise<ModelPointer> {
  if (!/^[a-f0-9]{64}$/.test(sha)) throw new Error('invalid-artifact-id');
  const bytes = await readFile(join(modelsDir, 'artifacts', sha));
  if (sha256(bytes) !== sha) throw new Error('artifact-hash-mismatch');
  try {
    await gate.validate(bytes);
  } catch {
    throw new Error('validation-failed');
  }
  const current = await readPointer(modelsDir, 'active.json');
  const pointer: ModelPointer = { sha256: sha, activatedAt: Date.now() };
  if (current) await writePointerAtomic(modelsDir, 'previous.json', current);
  await writePointerAtomic(modelsDir, 'active.json', pointer);
  return pointer;
}

export function activeModel(modelsDir: string): Promise<ModelPointer | null> {
  return readPointer(modelsDir, 'active.json');
}

export async function rollbackModel(modelsDir: string): Promise<ModelPointer | null> {
  const previous = await readPointer(modelsDir, 'previous.json');
  if (!previous) throw new Error('no-previous-model');
  const current = await readPointer(modelsDir, 'active.json');
  await writePointerAtomic(modelsDir, 'active.json', previous);
  if (current) await writePointerAtomic(modelsDir, 'previous.json', current);
  return previous;
}
