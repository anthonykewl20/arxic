import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { discoverNativeModels } from './model-catalog-bridge.mjs';

it('terminates its owned metadata process before returning, even if it ignores SIGTERM', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arxic-catalog-process-'));
  const command = join(root, 'metadata-agent');
  const pidFile = join(root, 'pid');
  await writeFile(
    command,
    `#!/usr/bin/env node\nconst fs=require('node:fs');fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.on('SIGTERM',()=>{});process.stdin.setEncoding('utf8');let input='';process.stdin.on('data',chunk=>{input+=chunk;let end;while((end=input.indexOf('\\n'))>=0){const message=JSON.parse(input.slice(0,end));input=input.slice(end+1);if(message.method==='initialize')process.stdout.write(JSON.stringify({id:1,result:{}})+'\\n');if(message.method==='model/list')process.stdout.write(JSON.stringify({id:2,result:{data:[{model:'provider/live[1m]'}],nextCursor:null}})+'\\n');}});setInterval(()=>{},1000);\n`,
    { mode: 0o700 },
  );
  let pid;
  try {
    const models = await discoverNativeModels('codex', {
      ...process.env,
      ARXIC_CODEX_COMMAND: command,
    });
    pid = Number(await readFile(pidFile, 'utf8'));
    expect(models).toEqual([{ id: 'provider/live[1m]' }]);
    expect(() => process.kill(pid, 0)).toThrow();
  } finally {
    if (pid)
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already reaped */
      }
    await rm(root, { recursive: true, force: true });
  }
});
