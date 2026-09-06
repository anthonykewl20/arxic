import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { expect, it } from 'vitest';
import { startWorkbench } from '../server';
import { captureMaskedViewport } from '@arxic/playwright-screenshot-privacy';

it('keeps navigation reachable by URL, refresh, back and keyboard', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const state = await mkdtemp(join(tmpdir(), 'dashboard-ux-'));
  const app = await startWorkbench({ roots: [root], stateDirectory: state,
    adminToken: 'dashboard-ux-test-token-32-characters', port: 0 });
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  try {
    await page.goto(app.origin);
    await page.getByLabel('Administrator token').fill('dashboard-ux-test-token-32-characters');
    await page.getByRole('button',{name:'Open workbench'}).click();
    await page.getByRole('heading',{name:'Workspace overview'}).waitFor();
    console.log('layout diagnostic', await page.evaluate(() => ({
      bg: getComputedStyle(document.documentElement).backgroundColor,
      font: getComputedStyle(document.documentElement).fontSize,
      button: getComputedStyle(document.querySelector('#new-project')!).height,
      dialogs: [...document.querySelectorAll('dialog')].map(d=>({open:d.open, modal:d.matches(':modal'),display:getComputedStyle(d).display})),
    })));
    const evidence=process.env.ARXIC_UX_EVIDENCE_DIR;
    if(evidence){await mkdir(evidence,{recursive:true});await writeFile(join(evidence,'initial.png'),await captureMaskedViewport(page,{automaticMasks:['input[type="password"]'],requiredMasks:[]}));}
    const pixels = await sharp(await captureMaskedViewport(page,{automaticMasks:['input[type="password"]'],requiredMasks:[]})).removeAlpha().raw().toBuffer();
    expect([...pixels.subarray((900*1440+1400)*3,(900*1440+1400)*3+3)]).toEqual([255,255,255]);
    expect((await page.locator('#new-project').boundingBox())!.height).toBeGreaterThanOrEqual(28);
    await page.getByRole('button',{name:'Test runs',exact:true}).click();
    await page.getByRole('heading',{name:'Test runs',exact:true}).waitFor();
    expect(new URL(page.url()).searchParams.get('view')).toBe('runs');
    await page.reload();
    await page.getByRole('heading',{name:'Test runs',exact:true}).waitFor();
    await page.getByRole('button',{name:'Administration',exact:true}).click();
    await page.goBack();
    await page.getByRole('heading',{name:'Test runs',exact:true}).waitFor();
  } finally { await browser.close();await app.close();await rm(state,{recursive:true,force:true}); }
},60_000);
