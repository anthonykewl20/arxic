import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { captureMaskedViewport } from '@arxic/playwright-screenshot-privacy';

/** Only fixed test annotations and numeric audit results enter retained evidence. */
export function dashboardProof(page: Page, directory: string | undefined) {
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
  const timeline: Array<{
    action: string;
    result: 'passed' | 'failed';
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
    async audit(name: string, action: string) {
      const report = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const overflow = await page.evaluate(() =>
        Math.max(0, document.documentElement.scrollWidth - innerWidth),
      );
      const safe = {
        violations: report.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          count: v.nodes.length,
        })),
        incomplete: report.incomplete.map((v) => ({ id: v.id, count: v.nodes.length })),
        overflow,
      };
      timeline.push({
        action,
        result: !safe.violations.length && !overflow ? 'passed' : 'failed',
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
            dirty,
          },
          null,
          2,
        ),
      );
    },
  };
}
