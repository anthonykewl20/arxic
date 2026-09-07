import { settleDashboard } from './dashboard-browser';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { captureMaskedViewport } from '@arxic/playwright-screenshot-privacy';

export type DashboardNumericCheck = { id: string; passed: boolean; values: Record<string, number> };

/** Retain fixed annotations, numeric audits and bounded tag/class geometry; no field values. */
export function dashboardProof(page: Page, directory: string | undefined) {
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
  const browser = page.context().browser();
  if (!browser) throw new Error('Dashboard proof requires an attached browser');
  const browserIdentity = { name: browser.browserType().name(), version: browser.version() };
  const timeline: Array<{
    action: string;
    result: 'passed' | 'failed' | 'unverified';
    screenshot: string;
    viewport: ReturnType<Page['viewportSize']>;
  }> = [];
  const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
  async function write(name: string, bytes: string | Buffer) {
    if (!directory) return;
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, name), bytes);
  }
  return {
    async audit(name: string, action: string, checks: DashboardNumericCheck[] = []) {
      await settleDashboard(page);
      const report = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      await settleDashboard(page);
      const overflow = await page.evaluate(() =>
        Math.max(0, document.documentElement.scrollWidth - innerWidth),
      );
      const overflowNodes = overflow
        ? await page.evaluate(() =>
            [...document.querySelectorAll('body *')]
              .flatMap((element) => {
                const box = element.getBoundingClientRect();
                const style = getComputedStyle(element);
                if (
                  !box.width ||
                  !box.height ||
                  style.visibility !== 'visible' ||
                  box.right <= innerWidth
                )
                  return [];
                return [
                  {
                    tag: element.tagName,
                    classes: (element.getAttribute('class') ?? '').slice(0, 256),
                    x: box.x,
                    y: box.y,
                    width: box.width,
                    height: box.height,
                    right: box.right,
                    overflowX: style.overflowX,
                    minWidth: style.minWidth,
                  },
                ];
              })
              .slice(0, 50),
          )
        : [];
      const safe = {
        violations: report.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          count: v.nodes.length,
        })),
        incomplete: report.incomplete.map((v) => ({ id: v.id, count: v.nodes.length })),
        overflow,
        overflowNodes,
        ...(checks.length ? { checks } : {}),
      };
      const verdict =
        safe.violations.length || overflow || checks.some((check) => !check.passed)
          ? 'failed'
          : safe.incomplete.length
            ? 'unverified'
            : 'passed';
      timeline.push({
        action,
        result: verdict,
        screenshot: `${name}.png`,
        viewport: page.viewportSize(),
      });
      if (directory) {
        const bytes = await captureMaskedViewport(page, {
          automaticMasks: ['input[type="password"]'],
          requiredMasks: [],
        });
        await write(`${name}.png`, bytes);
        await write(
          `${name}.png.privacy.json`,
          JSON.stringify(
            {
              sha256: hash(bytes),
              policy: 'persona-free test dashboard; password inputs masked',
              rawTraceRetained: false,
              humanInspection: 'not performed',
              sourceCommit,
              browser: browserIdentity,
              dirty,
            },
            null,
            2,
          ),
        );
        await write(`${name}.audit.json`, JSON.stringify(safe, null, 2));
      }
      return {
        ...safe,
        verdict,
        details: report.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
        })),
      };
    },
    async finish() {
      const bytes = JSON.stringify(timeline, null, 2);
      await write('timeline.json', bytes);
      await write(
        'timeline.sanitization.json',
        JSON.stringify(
          {
            sha256: hash(bytes),
            method:
              'allow-listed test annotations, viewport and result; no DOM/network/field payloads',
            rawTraceRetained: false,
            sourceCommit,
            browser: browserIdentity,
            dirty,
          },
          null,
          2,
        ),
      );
    },
  };
}
