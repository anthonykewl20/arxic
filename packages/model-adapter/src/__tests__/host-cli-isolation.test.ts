import { access, mkdtemp, readdir, rm, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createHostCliTransport } from '../host-cli-transport';

it('runs text-only account invocations in a private directory and removes it afterwards', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'arxic-cwd-test-'));
  try {
    const transport = createHostCliTransport({
      command: process.execPath,
      args: [
        '-e',
        'require("node:fs").writeFileSync(process.argv[1], process.cwd()); process.stdout.write(JSON.stringify({mode:require("node:fs").statSync(process.cwd()).mode & 511}))',
        join(parent, 'observed-cwd'),
      ],
      isolatedCwd: true,
      imageDirectory: parent,
    });
    const result = await transport({
      baseUrl: 'unused',
      bearerToken: 'unused',
      model: 'provider/context[1m]',
      messages: [{ role: 'user', content: 'Read no project files' }],
      schema: {},
      schemaName: 'cwd',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected successful process');
    const output = JSON.parse(result.raw.choices[0].message.content);
    const cwd = await readFile(join(parent, 'observed-cwd'), 'utf8');
    expect(cwd).not.toBe(process.cwd());
    expect(output.mode).toBe(0o700);
    await expect(access(cwd)).rejects.toThrow();
    await unlink(join(parent, 'observed-cwd'));
    expect(await readdir(parent)).toEqual([]);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
