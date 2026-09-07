/** Opt-in diagnostic, not a test-suite waiver. See WEB-454 follow-up proof for the command. */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import {
  bootFixtureApp,
  stopApp,
  vulnerableAuthApp,
} from '../../../../packages/real-world-testkit/src';
import { captureMaskedViewport } from '../../../../packages/playwright-screenshot-privacy/src/masked-viewport';
import { collectVisualScene } from '../visual-oracle';

const output = process.argv[2];
if (!output) throw new Error('Provide a new evidence directory');
await mkdir(output, { recursive: false });
const root = resolve(import.meta.dirname, '../../../..');
const target = await bootFixtureApp(root, vulnerableAuthApp, 'native-renderer-probe');
const proxy = createServer(async (_request, response) => {
  const html = await (await fetch(target.origin)).text();
  response.setHeader('content-type', 'text/html');
  response.end(
    html.replace('</head>', '<style>body{background:#f0e0d0;color:#111}</style></head>'),
  );
});
await new Promise<void>((done) => proxy.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`;
const masks = ['input,textarea,[contenteditable="true"]'];
const rows: Array<{
  renderer: string;
  run: number;
  stable: boolean;
  sha256: string;
  browserVersion: string;
}> = [];
try {
  for (const renderer of ['shell', 'full'] as const) {
    for (let run = 0; run < 16; run++) {
      const browser = await chromium.launch({
        headless: true,
        ...(renderer === 'full' ? { channel: 'chromium' } : {}),
      });
      try {
        const page = await browser.newPage({
          viewport: { width: 800, height: 600 },
          deviceScaleFactor: 3,
          colorScheme: 'light',
          locale: 'en-US',
          timezoneId: 'UTC',
          reducedMotion: 'reduce',
          serviceWorkers: 'block',
        });
        await page.goto(origin);
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        let previous = '',
          stable = false;
        let bytes: Buffer = Buffer.alloc(0);
        for (let attempt = 0; attempt < 6; attempt++) {
          const before = await collectVisualScene(page, masks);
          bytes = await captureMaskedViewport(page, {
            automaticMasks: masks,
            requiredMasks: [],
            scale: 'device',
          });
          const after = await collectVisualScene(page, masks);
          const hash = createHash('sha256').update(bytes).digest('hex');
          if (hash === previous && JSON.stringify(before) === JSON.stringify(after)) {
            stable = true;
            break;
          }
          previous = hash;
          await new Promise((done) => setTimeout(done, 150));
        }
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const row = { renderer, run, stable, sha256, browserVersion: browser.version() };
        rows.push(row);
        const name = `${renderer}-${run}.png`;
        await writeFile(join(output, name), bytes);
        await writeFile(
          join(output, `${name}.privacy.json`),
          JSON.stringify({ ...row, automaticMasks: masks, rawTraceRetained: false }),
        );
      } finally {
        await browser.close();
      }
    }
    console.log(
      JSON.stringify({
        renderer,
        uniqueHashes: new Set(
          rows.filter((row) => row.renderer === renderer).map((row) => row.sha256),
        ).size,
      }),
    );
  }
  await writeFile(join(output, 'summary.json'), JSON.stringify(rows, null, 2));
} finally {
  proxy.closeAllConnections();
  await new Promise<void>((done) => proxy.close(() => done()));
  await stopApp(target.child);
  await rm(target.runtimeDirectory, { recursive: true, force: true });
}
