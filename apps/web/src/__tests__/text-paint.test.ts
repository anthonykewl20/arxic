import { chromium } from 'playwright';
import { expect, it } from 'vitest';
import { collectTextPaint } from '../text-paint';

it('collects a numeric solid-paint projection without retaining text', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<style>body{background:white;color:#777}</style><p>PRIVATE TEST CONTENT</p>',
    );
    const records = await collectTextPaint(page, []);
    expect(records).toContainEqual(
      expect.objectContaining({
        foreground: [119, 119, 119],
        background: [255, 255, 255],
        unavailable: null,
      }),
    );
    expect(JSON.stringify(records)).not.toContain('PRIVATE');
  } finally {
    await browser.close();
  }
});

it('keeps paint ambiguity, privacy masks and semantic exceptions unverified', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const [style, markup, masks, reason] of [
      ['p::first-letter{color:red}', '<p>First letter</p>', [], 'complex-paint'],
      ['p::first-line{color:red}', '<p>First line</p>', [], 'complex-paint'],
      ['p{background:linear-gradient(white,black)}', '<p>Gradient</p>', [], 'complex-paint'],
      ['p{opacity:.5}', '<p>Opacity</p>', [], 'complex-paint'],
      ['p::before{content:"X";position:absolute}', '<p>Pseudo</p>', [], 'complex-paint'],
      ['', '<p data-private>SECRET LABEL</p>', ['[data-private]'], 'masked-text'],
      ['', '<button disabled>Disabled</button>', [], 'inactive-or-semantic-exception'],
      ['', '<p aria-hidden="true">Decorative</p>', [], 'inactive-or-semantic-exception'],
      ['p{background:rgba(255,255,255,.5)}', '<p>Alpha</p>', [], 'complex-paint'],
      [
        'p{position:absolute;top:20px;left:20px} aside{position:absolute;inset:0;background:white}',
        '<p>Covered</p><aside></aside>',
        [],
        'occluded-text',
      ],
    ] as const) {
      await page.setContent(
        `<style>body{background:white;color:#777;min-height:100vh}${style}</style>${markup}`,
      );
      const paints = await collectTextPaint(page, [...masks]);
      expect(paints.length).toBeGreaterThan(0);
      expect(
        paints.every((p) => p.unavailable === reason),
        reason,
      ).toBe(true);
      expect(JSON.stringify(paints)).not.toContain('SECRET');
    }
    await page.setContent('<p>Unknown canvas backing</p>');
    expect((await collectTextPaint(page, []))[0].unavailable).toBe('missing-opaque-background');
  } finally {
    await browser.close();
  }
});

it('does not expose arbitrary browser properties or accept malformed paint evidence', async () => {
  const record = {
    id: 0,
    box: { x: 0, y: 0, width: 30, height: 20, text: 'SECRET' },
    foreground: [0, 0, 0],
    background: [255, 255, 255],
    fontSize: 16,
    fontWeight: 400,
    unavailable: null,
    text: 'SECRET',
  };
  const page = { evaluate: async () => [record] } as unknown as Parameters<
    typeof collectTextPaint
  >[0];
  expect(JSON.stringify(await collectTextPaint(page, []))).not.toContain('SECRET');
  await expect(
    collectTextPaint(
      { evaluate: async () => [{ ...record, unavailable: 'SECRET' }] } as unknown as typeof page,
      [],
    ),
  ).rejects.toThrow('Invalid numeric text-paint evidence');
});

it('discloses a truncated scene instead of passing the retained text subset', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<style>body{background:white}</style><p>Budget boundary</p>' + '<div></div>'.repeat(2100),
    );
    const paints = await collectTextPaint(page, []);
    expect(paints.length).toBeGreaterThan(0);
    expect(paints.every((paint) => paint.unavailable === 'collection-budget')).toBe(true);
  } finally {
    await browser.close();
  }
});
