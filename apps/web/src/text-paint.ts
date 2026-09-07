import type { Page } from 'playwright';
import { validTextPaint, type TextPaint } from './text-contrast';

/** Read-only observation of direct HTML text. No text, selectors, attributes or font names leave the browser. */
export async function collectTextPaint(page: Page, masks: string[]): Promise<TextPaint[]> {
  const result = await page.evaluate((masks): TextPaint[] => {
    const all: Element[] = [];
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
    let current: Element | null = document.documentElement;
    while (current && all.length < 2000) {
      all.push(current);
      current = walker.nextNode() as Element | null;
    }
    const truncated = current !== null;
    const boxes = new Map(all.map((el) => [el, el.getBoundingClientRect()]));
    const styles = new Map(all.map((el) => [el, getComputedStyle(el)]));
    // Anonymous tuple callbacks stay serialization-safe in the isolated tsx job.
    const helpers = [
      (a: DOMRect, b: DOMRect) =>
        a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top,
      (value: string): [number, number, number, number] | null => {
        const match =
          /^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/u.exec(value);
        if (!match) return null;
        const rgb = [Number(match[1]), Number(match[2]), Number(match[3])] as [
          number,
          number,
          number,
        ];
        const alpha = match[4] === undefined ? 1 : Number(match[4]);
        return rgb.every((c) => c >= 0 && c <= 255) && alpha >= 0 && alpha <= 1
          ? [...rgb, alpha]
          : null;
      },
    ] as const;
    const maskBoxes = masks.flatMap((mask) =>
      [...document.querySelectorAll(mask)].map((el) => el.getBoundingClientRect()),
    );
    // Effects can paint beyond their DOM rectangle, so this initial profile cannot localize them safely.
    const unknownPaint = all.some((el) => {
      const style = styles.get(el)!;
      if (style.display === 'none' || style.visibility !== 'visible') return false;
      return (
        style.boxShadow !== 'none' ||
        style.filter !== 'none' ||
        style.backdropFilter !== 'none' ||
        ['::before', '::after'].some((pseudo) => {
          const p = getComputedStyle(el, pseudo);
          return p.content !== 'none' && p.content !== 'normal' && p.display !== 'none';
        })
      );
    });
    const records: TextPaint[] = [];
    for (const el of all) {
      if (
        !(el instanceof HTMLElement) ||
        ![...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())
      )
        continue;
      const style = styles.get(el)!;
      if (style.visibility !== 'visible' || style.display === 'none') continue;
      // Only direct text fragments; descendant text gets its own measurement record.
      const fragments = [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())
        .flatMap((n) => {
          const range = document.createRange();
          range.selectNode(n);
          return [...range.getClientRects()];
        })
        .filter(
          (r) =>
            r.width > 0 &&
            r.height > 0 &&
            r.right > 0 &&
            r.bottom > 0 &&
            r.left < innerWidth &&
            r.top < innerHeight,
        );
      if (!fragments.length) continue;
      const left = Math.min(...fragments.map((r) => r.left));
      const top = Math.min(...fragments.map((r) => r.top));
      const right = Math.max(...fragments.map((r) => r.right));
      const bottom = Math.max(...fragments.map((r) => r.bottom));
      const box = { x: left, y: top, width: right - left, height: bottom - top };
      let unavailable: TextPaint['unavailable'] = truncated
        ? 'collection-budget'
        : unknownPaint
          ? 'complex-paint'
          : null;
      if (fragments.some((r) => maskBoxes.some((m) => helpers[0](r, m))))
        unavailable = 'masked-text';
      else if (
        el.closest(':disabled,[aria-disabled="true"],[aria-hidden="true"],[role="img"],svg,canvas')
      )
        unavailable = 'inactive-or-semantic-exception';
      if (
        ['::first-letter', '::first-line'].some((pseudo) => {
          const p = getComputedStyle(el, pseudo);
          return (
            p.color !== style.color ||
            p.fontSize !== style.fontSize ||
            p.fontWeight !== style.fontWeight ||
            p.textShadow !== style.textShadow ||
            p.backgroundColor !== 'rgba(0, 0, 0, 0)'
          );
        }) ||
        !window.getSelection()?.isCollapsed
      )
        unavailable ??= 'complex-paint';
      const fg = helpers[1](style.color);
      const fill = helpers[1](style.getPropertyValue('-webkit-text-fill-color') || style.color);
      if (!fg || fg[3] !== 1 || !fill || fill.some((c, i) => c !== fg[i]))
        unavailable ??= 'unsupported-color';
      let background: TextPaint['background'] = null;
      for (let ancestor: Element | null = el; ancestor; ancestor = ancestor.parentElement) {
        const s = styles.get(ancestor) ?? getComputedStyle(ancestor);
        const bounds = boxes.get(ancestor) ?? ancestor.getBoundingClientRect();
        if (
          s.opacity !== '1' ||
          s.transform !== 'none' ||
          s.mixBlendMode !== 'normal' ||
          s.textShadow !== 'none' ||
          s.backgroundImage !== 'none' ||
          s.backgroundClip !== 'border-box' ||
          s.maskImage !== 'none' ||
          s.clipPath !== 'none' ||
          s.perspective !== 'none' ||
          (s.zoom !== '1' && s.zoom !== 'normal') ||
          s.getPropertyValue('-webkit-text-stroke-width') !== '0px' ||
          s.visibility !== 'visible' ||
          s.fontVariantCaps !== 'normal' ||
          ((s.overflowX !== 'visible' || s.overflowY !== 'visible') &&
            fragments.some(
              (r) =>
                r.left < bounds.left ||
                r.right > bounds.right ||
                r.top < bounds.top ||
                r.bottom > bounds.bottom,
            ))
        )
          unavailable ??= 'complex-paint';
        if (!background) {
          const bg = helpers[1](s.backgroundColor);
          if (!bg) unavailable ??= 'unsupported-color';
          else if (bg[3] === 1) {
            if (
              fragments.some(
                (r) =>
                  r.left < bounds.left ||
                  r.right > bounds.right ||
                  r.top < bounds.top ||
                  r.bottom > bounds.bottom,
              ) ||
              [
                s.borderTopLeftRadius,
                s.borderTopRightRadius,
                s.borderBottomLeftRadius,
                s.borderBottomRightRadius,
              ].some((v) => v !== '0px')
            )
              unavailable ??= 'complex-paint';
            background = [bg[0], bg[1], bg[2]];
          } else if (bg[3] !== 0) unavailable ??= 'complex-paint';
        }
      }
      if (!background) unavailable ??= 'missing-opaque-background';
      // Non-ancestor boxes intersecting the text may paint over or behind it. No z-index guess can waive them.
      if (
        all.some(
          (other) =>
            other !== el &&
            !other.contains(el) &&
            styles.get(other)!.display !== 'none' &&
            styles.get(other)!.visibility === 'visible' &&
            fragments.some((r) => helpers[0](r, boxes.get(other)!)),
        )
      )
        unavailable ??= 'occluded-text';
      if (document.fonts.status !== 'loaded' || !style.font || !document.fonts.check(style.font))
        unavailable ??= 'unavailable-font';
      const fontSize = parseFloat(style.fontSize);
      const fontWeight = Number(style.fontWeight);
      records.push({
        id: records.length,
        box,
        foreground: fg ? [fg[0], fg[1], fg[2]] : null,
        background,
        fontSize,
        fontWeight,
        unavailable,
      });
    }
    return records;
  }, masks);
  if (!validTextPaint(result)) throw new Error('Invalid numeric text-paint evidence');
  // Reconstruct exact allow-listed fields even if the browser supplies extra keys.
  return result.map((p) => ({
    id: p.id,
    box: { x: p.box.x, y: p.box.y, width: p.box.width, height: p.box.height },
    foreground: p.foreground ? [p.foreground[0], p.foreground[1], p.foreground[2]] : null,
    background: p.background ? [p.background[0], p.background[1], p.background[2]] : null,
    fontSize: p.fontSize,
    fontWeight: p.fontWeight,
    unavailable: p.unavailable,
  }));
}
