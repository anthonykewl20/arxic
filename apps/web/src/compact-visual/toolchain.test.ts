import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { it } from 'vitest';

const execute = promisify(execFile);
it('runs independent numerical gradients and actual native malformed-artifact tests', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const directory = await mkdtemp(join(tmpdir(), 'visual-native-test-'));
  try {
    await execute(
      process.env.ARXIC_VISUAL_PYTHON ?? 'python3',
      [join(root, 'scripts/visual-slm/test_train.py')],
      { timeout: 30000 },
    );
    await execute(
      process.env.ARXIC_VISUAL_PYTHON ?? 'python3',
      [join(root, 'scripts/visual-slm/test_ablate.py')],
      { timeout: 30000 },
    );
    await execute(
      process.env.ARXIC_VISUAL_PYTHON ?? 'python3',
      [join(root, 'scripts/visual-slm/test_timing_dataset.py')],
      { timeout: 60000 },
    );
    await execute(
      process.env.ARXIC_VISUAL_RUSTC ?? 'rustc',
      ['--test', join(root, 'scripts/visual-slm/native.rs'), '-o', join(directory, 'tests')],
      { timeout: 60000 },
    );
    await execute(join(directory, 'tests'), [], { timeout: 10000 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 90000);
