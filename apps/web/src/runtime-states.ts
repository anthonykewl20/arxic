import { chromium } from 'playwright';
import {
  classifyStateText,
  type RuntimeStateDimensionName,
  type RuntimeStateObservation,
} from './route-coverage';

/**
 * Runtime state observation (refs #402): visits the discovered page routes on
 * the project origin with real Chromium, settles hydration, and classifies
 * RENDERED state markers with the source tier's shared vocabulary. Plain
 * navigation only — an unobserved state is never proof it cannot render.
 */
export type RuntimeStatePass =
  | { gap: string; observations?: undefined }
  | { observations: RuntimeStateObservation[]; gap?: undefined };

const MAX_ROUTES = 12;
const PAGE_TIMEOUT_MS = 10_000;
const SETTLE_MS = 750;

/** Cheap reachability probe so unreachable origins (CI stubs) skip instantly. */
async function reachable(origin: string): Promise<boolean> {
  try {
    const response = await fetch(origin, {
      signal: AbortSignal.timeout(2_500),
      redirect: 'manual',
    });
    return response.status < 500;
  } catch {
    return false;
  }
}

export async function observeRuntimeStates(
  origin: string,
  paths: readonly string[],
): Promise<RuntimeStatePass> {
  if (!origin) return { gap: 'origin-unconfigured' };
  if (!(await reachable(origin))) return { gap: 'origin-unreachable' };
  const targets = [...new Set(paths)]
    .slice(0, MAX_ROUTES)
    .sort((left, right) => left.localeCompare(right));
  const observations: RuntimeStateObservation[] = [];
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    for (const path of targets) {
      try {
        await page.goto(`${origin}${path}`, {
          waitUntil: 'networkidle',
          timeout: PAGE_TIMEOUT_MS,
        });
      } catch {
        // Fall back to whatever loaded; navigation timeouts still render.
        await page.waitForLoadState('domcontentloaded').catch(() => undefined);
      }
      await page.waitForTimeout(SETTLE_MS);
      const observed = await page
        .evaluate(() => {
          const busy = document.querySelector('[aria-busy="true"]') !== null;
          return { text: document.body?.innerText ?? '', busy };
        })
        .catch(() => ({ text: '', busy: false }));
      const states = new Set<RuntimeStateDimensionName>(classifyStateText(observed.text));
      if (observed.busy) states.add('state:loading');
      observations.push({ path, states: [...states] });
    }
  } catch {
    return { gap: 'observation-failed' };
  } finally {
    await browser?.close().catch(() => undefined);
  }
  return { observations };
}
