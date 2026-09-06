import type { Locator, Page } from 'playwright';
import { settleDashboard } from './dashboard-browser';

const overrides = new WeakMap<Page, { href: string; start: number; count: number }>();

/** Test-only user stylesheet rules; CSP stays enabled and application state is untouched. */
export async function applyTextProfile(page: Page, profile: string) {
  if (profile !== 'spacing' && profile !== 'text-200' && profile !== 'default')
    throw new Error('Unsupported text profile');
  const previous = overrides.get(page);
  const applied = await page.evaluate(
    ({ selected, previous }) => {
      const sheet = [...document.styleSheets].find(
        (sheet) => sheet.href && new URL(sheet.href).origin === location.origin,
      );
      if (!sheet?.href) throw new Error('No same-origin dashboard stylesheet');
      if (previous) {
        if (previous.href !== sheet.href) throw new Error('Readability stylesheet changed');
        for (let i = previous.count - 1; i >= 0; i--) sheet.deleteRule(previous.start + i);
      }
      for (const element of document.querySelectorAll('[data-arxic-text-size]'))
        element.removeAttribute('data-arxic-text-size');
      const rules: string[] = [];
      if (selected === 'spacing')
        rules.push(
          '* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; }',
          'p { margin-bottom: 2em !important; }',
        );
      if (selected === 'text-200') {
        // Snapshot before mutating: descendants must not compound inherited enlargement.
        // Reapply explicitly after mounting a new view; this is not browser zoom.
        const sizes = [...document.querySelectorAll('body, body *')]
          .filter((element) => element instanceof HTMLElement)
          .map((element) => ({ element, size: parseFloat(getComputedStyle(element).fontSize) }));
        for (const [{ element, size }, index] of sizes.map(
          (entry, index) => [entry, index] as const,
        )) {
          element.setAttribute('data-arxic-text-size', String(index));
          rules.push(`[data-arxic-text-size="${index}"] { font-size: ${size * 2}px !important; }`);
        }
      }
      const start = sheet.cssRules.length;
      for (const rule of rules) sheet.insertRule(rule, sheet.cssRules.length);
      return { href: sheet.href, start, count: rules.length };
    },
    { selected: profile, previous },
  );
  overrides.set(page, applied);
  await settleDashboard(page);
}

/** Read-only line rectangles for an explicitly named text control, not an optical/glyph oracle. */
export async function measureControlText(control: Locator, recoveredTextSelector?: string) {
  return control.evaluate((element, recoveredSelector) => {
    const rect = element.getBoundingClientRect();
    const box = {
      x: rect.x,
      y: rect.y,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const lines = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent?.trim()) continue;
      if (recoveredSelector && node.parentElement?.matches(recoveredSelector)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const line of range.getClientRects())
        lines.push({
          x: line.x,
          y: line.y,
          right: line.right,
          bottom: line.bottom,
          width: line.width,
          height: line.height,
        });
    }
    return {
      box,
      lines,
      fits:
        lines.length > 0 &&
        lines.every(
          (line) =>
            line.x >= box.x &&
            line.y >= box.y &&
            line.right <= box.right &&
            line.bottom <= box.bottom,
        ),
    };
  }, recoveredTextSelector);
}
