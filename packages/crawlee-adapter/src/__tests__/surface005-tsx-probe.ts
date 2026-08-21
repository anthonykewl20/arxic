/**
 * DG-289 (#289, SURFACE-005) — SP-1 lane probe. NOT a vitest test file.
 *
 * Executed BY packages/crawlee-adapter/src/__tests__/surface005-regression.real-world.test.ts
 * as a tsx CHILD PROCESS, because the defect lives in the tsx transform
 * lane: tsx's esbuild transform injects `__name(...)` wraps for named inner
 * functions, and any such wrap inside a `page.evaluate` callback body ends
 * up in the serialized source (Function.toString) where the page context
 * cannot resolve it (`ReferenceError: __name is not defined`). Vitest's own
 * transform does not inject the helper, so the regression must be proven in
 * this child — the same source-execution lane as
 * packages/intent-proposal-spike/scripts/dg11-run-validation.ts:1162.
 *
 * argv: --origin http://127.0.0.1:<port>   (the booted reference-auth-app)
 *
 * Prints exactly one JSON verdict line on stdout:
 * {
 *   controlInjected: boolean,   // POSITIVE CONTROL — the tsx lane DOES inject __name
 *                               // for named inner helpers; if this is ever false the
 *                               // probeClean assertion below is vacuous and the test fails.
 *   probeClean: boolean,        // neither serialized callback source contains __name
 *   routes: string[],           // real-Chromium crawl inventory paths
 *   crawlRootSubject: string,
 *   surface005AtRoot: object[], // must be empty (crawl completes, zero root failures)
 *   identitySame: boolean,      // elementIdentityProbe: same-element handles → true
 *   identityDifferent: boolean  // elementIdentityProbe: distinct elements → false
 * }
 */
import { chromium } from 'playwright';
import { CrawleeSurfaceDiscoverer, pageInventoryProbe } from '../adapter';
import { ARXIC_SURFACE_NAVIGATION_FAILED } from '../diagnostics';
import { elementIdentityProbe } from '../../../playwright-agent-adapter/src/exploration-driver';

/** Positive control: a named inner helper MUST attract the __name wrap in this lane. */
const POSITIVE_CONTROL = (): number => {
  const named = (value: number): number => value + 1;
  return named(1);
};

async function main(): Promise<void> {
  const originIndex = process.argv.indexOf('--origin');
  const origin = originIndex === -1 ? undefined : process.argv[originIndex + 1];
  if (!origin) throw new Error('usage: surface005-tsx-probe.ts --origin http://127.0.0.1:<port>');

  const controlInjected = String(POSITIVE_CONTROL).includes('__name');
  const probeClean =
    !String(pageInventoryProbe).includes('__name') &&
    !String(elementIdentityProbe).includes('__name');

  const adapter = new CrawleeSurfaceDiscoverer({ maxRequestRetries: 1 });
  const result = await adapter.collect({ origin, maxUrls: 8, maxDepth: 1 });
  const crawlRootSubject = `${origin}/`;
  const surface005AtRoot = result.diagnostics.filter(
    (diagnostic) =>
      diagnostic.code === ARXIC_SURFACE_NAVIGATION_FAILED &&
      diagnostic.subject === crawlRootSubject,
  );

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<html><body><button id="same-a">go</button><button id="same-b" class="other">alt</button><input id="distinct"></body></html>',
    );
    const first = await page.locator('#same-a').elementHandle();
    const alias = await page.locator('button#same-a').elementHandle();
    const distinct = await page.locator('#distinct').elementHandle();
    if (!first || !alias || !distinct) throw new Error('probe page handles missing');
    const identitySame = await page.evaluate(elementIdentityProbe, [first, alias]);
    const identityDifferent = await page.evaluate(elementIdentityProbe, [first, distinct]);
    console.log(
      JSON.stringify({
        controlInjected,
        probeClean,
        routes: result.routes.map((route) => route.path),
        crawlRootSubject,
        surface005AtRoot,
        identitySame,
        identityDifferent,
      }),
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(
    `surface005-tsx-probe failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
