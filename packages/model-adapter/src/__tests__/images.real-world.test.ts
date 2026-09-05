import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { expect, it } from 'vitest';
import { sha256 } from '@arxic/contracts';
import { captureMaskedViewport } from '@arxic/playwright-screenshot-privacy';
import { bootFixtureApp, vulnerableAuthApp, stopApp } from '../../../real-world-testkit/src';
import { ModelAdapter, createHostCliTransport } from '..';
import { adapterRequest, BEARER_TOKEN, completion, startStub, validOutput } from './stub';

it('transmits actual reference-app PNGs and bounds host attachment lifetime', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const target = await bootFixtureApp(root, vulnerableAuthApp, 'model-image');
  const browser = await chromium.launch({ headless: true });
  const directory = await mkdtemp(join(tmpdir(), 'arxic-model-image-proof-'));
  const stub = await startStub(() => ({ completion: completion(JSON.stringify(validOutput())) }));
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto(target.origin);
    const bytes = await captureMaskedViewport(page, {
      automaticMasks: ['input', 'textarea'],
      requiredMasks: [],
    });
    const image = { mediaType: 'image/png' as const, bytes, sha256: sha256(bytes) };
    const request = { ...adapterRequest(), images: [image] };
    const http = await new ModelAdapter({
      baseUrl: stub.baseUrl,
      credentials: BEARER_TOKEN,
    }).requestStructuredOutput(request);
    expect(http.ok).toBe(true);
    const messages = (stub.requests[0].body as { messages: unknown[] }).messages;
    expect(messages.at(-1)).toEqual({
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${bytes.toString('base64')}`, detail: 'high' },
        },
      ],
    });
    expect(http.runRecord).toMatchObject({
      images: [
        {
          mediaType: 'image/png',
          sha256: image.sha256,
          bytes: bytes.length,
          width: 800,
          height: 600,
        },
      ],
    });
    expect(JSON.stringify(http)).not.toContain(bytes.toString('base64'));

    // Ownership is acquired before a credential resolver can mutate the caller's buffer.
    const mutable = Buffer.from(bytes);
    const owned = await new ModelAdapter({
      baseUrl: stub.baseUrl,
      credentials: async () => {
        mutable.fill(0);
        return BEARER_TOKEN;
      },
    }).requestStructuredOutput({ ...request, images: [{ ...image, bytes: mutable }] });
    expect(owned.ok).toBe(true);
    expect(JSON.stringify(stub.requests[1].body).includes(bytes.toString('base64'))).toBe(true);
    const mismatched = await new ModelAdapter({
      baseUrl: stub.baseUrl,
      credentials: BEARER_TOKEN,
    }).requestStructuredOutput({ ...request, images: [{ ...image, sha256: '0'.repeat(64) }] });
    expect(mismatched).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'ARXIC-MODEL-IMAGE-INVALID' })],
    });
    expect(stub.requests).toHaveLength(2);

    const marker = join(directory, 'path.json');
    for (const mode of ['success', 'failure', 'timeout', 'path-echo']) {
      const transport = createHostCliTransport({
        command: process.execPath,
        args: [
          '-e',
          `
        const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
        const file=process.argv[1];
        fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({file,mode:fs.statSync(file).mode&511,parentMode:fs.statSync(path.dirname(file)).mode&511,hash:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}));
        process.stdin.resume();
        ${mode === 'timeout' ? 'setInterval(()=>{},1000)' : mode === 'failure' ? 'process.exitCode=1' : mode === 'path-echo' ? `const payload=${JSON.stringify(validOutput())};payload.candidates[0].intent=file;process.stdout.write(JSON.stringify(payload))` : `process.stdout.write(${JSON.stringify(JSON.stringify(validOutput()))})`}
      `,
        ],
        imageArgs: ['{image}'],
      });
      const result = await new ModelAdapter({
        baseUrl: 'unused',
        credentials: 'host-bound-test',
        transport,
        timeoutMs: 2000,
        providerMeta: { provider: 'host-bound' },
      }).requestStructuredOutput(request);
      expect(result.ok).toBe(mode === 'success');
      const attachment = JSON.parse(await readFile(marker, 'utf8'));
      expect(attachment).toMatchObject({ hash: image.sha256, mode: 0o600, parentMode: 0o700 });
      await expect(stat(attachment.file)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(JSON.stringify(result)).not.toContain(attachment.file);
    }
    await rm(marker);
    const incapable = createHostCliTransport({
      command: process.execPath,
      args: [
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(marker)},'spawned');process.stdout.write(${JSON.stringify(JSON.stringify(validOutput()))})`,
      ],
    });
    const blocked = await new ModelAdapter({
      baseUrl: 'unused',
      credentials: 'host-bound-test',
      transport: incapable,
    }).requestStructuredOutput(request);
    expect(blocked.ok).toBe(false);
    await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await stub.close();
    await browser.close();
    await stopApp(target.child);
    await rm(directory, { recursive: true, force: true });
    await rm(target.runtimeDirectory, { recursive: true, force: true });
  }
}, 60_000);
