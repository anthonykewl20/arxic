import { access, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from '@playwright/test';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import {
  SCREENSHOT_CAPTURE_CORRELATION_ENV,
  SCREENSHOT_CAPTURED_AT_ENV,
  SCREENSHOT_PRIVACY_POLICY_ENV,
  SCREENSHOT_PRIVACY_POLICY_SHA256_ENV,
  capturePolicyScreenshot,
  inspectPng,
  readUntrustedScreenshotCaptureReceipt,
  screenshotCaptureReceiptPath,
  screenshotPrivacyAttestationPath,
  screenshotPrivacyRuntimeSource,
  serializeScreenshotPrivacyPolicy,
} from './index';

const environmentNames = [
  SCREENSHOT_PRIVACY_POLICY_ENV,
  SCREENSHOT_PRIVACY_POLICY_SHA256_ENV,
  SCREENSHOT_CAPTURE_CORRELATION_ENV,
  SCREENSHOT_CAPTURED_AT_ENV,
] as const;
const directories: string[] = [];
let browser: Browser | undefined;

describe('real Chromium policy-owned screenshot capture', () => {
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterEach(async () => {
    for (const name of environmentNames) delete process.env[name];
    await Promise.all(
      directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  afterAll(async () => {
    await browser?.close();
  });

  test('fails closed without action-supplied policy and retains no PNG or receipt', async () => {
    const page = await pageWith('<h1>Safe heading</h1>');
    const path = await outputPath();

    await expect(capturePolicyScreenshot(page, path)).rejects.toThrow(
      /ARXIC-SCREENSHOT-CAPTURE-FAILED/u,
    );
    await expect(exists(path)).resolves.toBe(false);
    await expect(exists(screenshotCaptureReceiptPath(path))).resolves.toBe(false);
    await page.close();
  });

  test('removes an unexpected pre-existing artifact and blocks capture', async () => {
    const page = await pageWith('<h1>Safe heading</h1>');
    const path = await outputPath();
    configurePolicy('Safe heading');
    await writeFile(path, 'untrusted pixels');

    await expect(capturePolicyScreenshot(page, path)).rejects.toThrow(
      /unexpected pre-existing screenshot artifact/u,
    );
    await expect(exists(path)).resolves.toBe(false);
    await page.close();
  });

  test('blocks an ambiguous approved region and cleans every source artifact', async () => {
    const page = await pageWith('<h1>Safe heading</h1><h1>Safe heading</h1>');
    const path = await outputPath();
    configurePolicy('Safe heading');

    await expect(capturePolicyScreenshot(page, path)).rejects.toThrow(/exactly one element/u);
    await expect(exists(path)).resolves.toBe(false);
    await expect(exists(screenshotCaptureReceiptPath(path))).resolves.toBe(false);
    await page.close();
  });

  test('blocks a masked-page capture when a declared semantic mask resolves to nothing', async () => {
    const page = await pageWith('<h1>Safe heading</h1><p>private rendered value</p>');
    const path = await outputPath();
    configureMaskedPolicy('Missing private field');

    await expect(capturePolicyScreenshot(page, path)).rejects.toThrow(/mask locator/u);
    await expect(exists(path)).resolves.toBe(false);
    await expect(exists(screenshotCaptureReceiptPath(path))).resolves.toBe(false);
    await page.close();
  });

  test('waits for partial capture writes and removes every temporary byte on failure', async () => {
    const page = await pageWith('<h1>Safe heading</h1>');
    const directory = await mkdtemp(join(tmpdir(), 'arxic-screenshot-partial-write-'));
    directories.push(directory);
    const path = join(directory, `${'a'.repeat(226)}.png`);
    configurePolicy('Safe heading');

    await expect(capturePolicyScreenshot(page, path)).rejects.toThrow(
      /ARXIC-SCREENSHOT-CAPTURE-FAILED/u,
    );
    await expect(readdir(directory)).resolves.toEqual([]);
    await page.close();
  });

  test('rejects a symlinked capture directory before writing external bytes', async () => {
    const page = await pageWith('<h1>Safe heading</h1>');
    const directory = await mkdtemp(join(tmpdir(), 'arxic-screenshot-symlink-parent-'));
    const externalDirectory = await mkdtemp(join(tmpdir(), 'arxic-screenshot-symlink-target-'));
    directories.push(directory, externalDirectory);
    const linkedDirectory = join(directory, 'linked');
    await symlink(externalDirectory, linkedDirectory, 'dir');
    configurePolicy('Safe heading');

    await expect(
      capturePolicyScreenshot(page, join(linkedDirectory, 'approved.png')),
    ).rejects.toThrow(/ARXIC-SCREENSHOT-CAPTURE-FAILED/u);
    await expect(readdir(externalDirectory)).resolves.toEqual([]);
    await page.close();
  });

  test('captures only the approved semantic region and emits an untrusted receipt', async () => {
    const page = await pageWith(
      '<h1>Safe heading</h1><p>ARBITRARY-PIXEL-CANARY-MUST-NOT-BE-IN-APPROVED-REGION</p>',
    );
    const path = await outputPath();
    const policy = configurePolicy('Safe heading');

    await capturePolicyScreenshot(page, path);

    const bytes = await readFile(path);
    const inspected = inspectPng(bytes);
    expect(inspected.width).toBeLessThan(1280);
    expect(inspected.height).toBeLessThan(200);
    await expect(
      readUntrustedScreenshotCaptureReceipt(screenshotCaptureReceiptPath(path)),
    ).resolves.toMatchObject({
      kind: 'arxic-untrusted-screenshot-capture',
      screenshotFile: 'approved.png',
      screenshotSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      screenshotBytes: bytes.length,
      policySha256: policy.sha256,
      correlationSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      captureMode: 'approved-region',
      playwrightVersion: '1.62.1',
    });
    await expect(exists(screenshotPrivacyAttestationPath(path))).resolves.toBe(false);
    expect(screenshotPrivacyRuntimeSource()).toContain(
      'export async function capturePolicyScreenshot',
    );
    await page.close();
  });
});

async function pageWith(html: string) {
  if (!browser) throw new Error('Chromium did not start');
  const page = await browser.newPage();
  await page.setContent(`<main>${html}</main>`);
  return page;
}

async function outputPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-screenshot-capture-'));
  directories.push(directory);
  return join(directory, 'approved.png');
}

function configurePolicy(heading: string) {
  const serialized = serializeScreenshotPrivacyPolicy({
    schemaVersion: 1,
    id: 'fixture-home-heading',
    authority: {
      kind: 'declared-human-approval',
      reference: 'docs/evidence/M1-SCREENSHOT-PRIVACY/README.md',
      recordedAt: '2026-08-09T12:00:00.000Z',
    },
    capture: {
      mode: 'approved-region',
      region: { kind: 'role', role: 'heading', name: heading, exact: true },
      masks: [],
    },
  });
  process.env[SCREENSHOT_PRIVACY_POLICY_ENV] = serialized.json;
  process.env[SCREENSHOT_PRIVACY_POLICY_SHA256_ENV] = serialized.sha256;
  process.env[SCREENSHOT_CAPTURE_CORRELATION_ENV] = 'correlation-value-0001';
  process.env[SCREENSHOT_CAPTURED_AT_ENV] = '2026-08-09T12:01:00.000Z';
  return serialized;
}

function configureMaskedPolicy(label: string) {
  const serialized = serializeScreenshotPrivacyPolicy({
    schemaVersion: 1,
    id: 'fixture-private-field-mask',
    authority: {
      kind: 'declared-human-approval',
      reference: 'docs/evidence/M1-SCREENSHOT-PRIVACY/README.md',
      recordedAt: '2026-08-09T12:00:00.000Z',
    },
    capture: {
      mode: 'masked-page',
      fullPage: true,
      masks: [{ kind: 'label', name: label, exact: true }],
    },
  });
  process.env[SCREENSHOT_PRIVACY_POLICY_ENV] = serialized.json;
  process.env[SCREENSHOT_PRIVACY_POLICY_SHA256_ENV] = serialized.sha256;
  process.env[SCREENSHOT_CAPTURE_CORRELATION_ENV] = 'correlation-value-0001';
  process.env[SCREENSHOT_CAPTURED_AT_ENV] = '2026-08-09T12:01:00.000Z';
  return serialized;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
