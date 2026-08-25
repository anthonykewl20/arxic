import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import type { Locator, Page } from '@playwright/test';

export const SCREENSHOT_PRIVACY_POLICY_ENV = 'ARXIC_SCREENSHOT_PRIVACY_POLICY' as const;
export const SCREENSHOT_PRIVACY_POLICY_SHA256_ENV =
  'ARXIC_SCREENSHOT_PRIVACY_POLICY_SHA256' as const;
export const SCREENSHOT_CAPTURE_CORRELATION_ENV = 'ARXIC_SCREENSHOT_CAPTURE_CORRELATION' as const;
export const SCREENSHOT_CAPTURED_AT_ENV = 'ARXIC_SCREENSHOT_CAPTURED_AT' as const;

export type ScreenshotSemanticLocator =
  | Readonly<{ kind: 'role'; role: string; name?: string; exact: true }>
  | Readonly<{ kind: 'label'; name: string; exact: true }>;

export type ScreenshotPolicyAuthority = Readonly<{
  kind: 'declared-human-approval' | 'repository-policy';
  reference: string;
  recordedAt: string;
}>;

export type ScreenshotPrivacyPolicy = Readonly<{
  schemaVersion: 1;
  id: string;
  authority: ScreenshotPolicyAuthority;
  capture:
    | Readonly<{
        mode: 'approved-region';
        region: ScreenshotSemanticLocator;
        masks: readonly ScreenshotSemanticLocator[];
      }>
    | Readonly<{
        mode: 'masked-page';
        fullPage: boolean;
        masks: readonly [ScreenshotSemanticLocator, ...ScreenshotSemanticLocator[]];
      }>;
}>;

export class ScreenshotPrivacyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'ScreenshotPrivacyError';
    this.code = code;
  }
}

export type UntrustedScreenshotCaptureReceipt = Readonly<{
  schemaVersion: 1;
  kind: 'arxic-untrusted-screenshot-capture';
  screenshotFile: string;
  screenshotSha256: string;
  screenshotBytes: number;
  policySha256: string;
  correlationSha256: string;
  captureMode: 'approved-region' | 'masked-page';
  // #314 (F-E10): present ONLY when masked-page capture adapted its masks to
  // the page's real landmarks because a declared anchor was absent — lists
  // the landmark roles actually masked (always a superset of the declared
  // intent's resolved anchors; masking more can never expose more).
  maskAdaptation?: readonly string[];
  playwrightVersion: '1.62.1';
  browserVersion: string;
  capturedAt: string;
}>;

export function serializeScreenshotPrivacyPolicy(input: unknown): {
  policy: ScreenshotPrivacyPolicy;
  json: string;
  sha256: string;
} {
  const policy = validatePolicy(input);
  const json = JSON.stringify(canonicalize(policy));
  return {
    policy,
    json,
    sha256: createHash('sha256').update(json).digest('hex'),
  };
}

export function screenshotCaptureReceiptPath(screenshotPath: string): string {
  return `${screenshotPath}.capture.json`;
}

export function screenshotPrivacyAttestationPath(screenshotPath: string): string {
  return `${screenshotPath}.privacy.json`;
}

/**
 * Executes inside the generated Playwright suite. The receipt is deliberately
 * untrusted; only a verifier/M0/exploration action may create authoritative
 * promotion provenance after independently checking the compiled binding.
 */
export async function capturePolicyScreenshot(page: Page, screenshotPath: string): Promise<void> {
  if (!screenshotPath.endsWith('.png') || basename(screenshotPath) === '.png') {
    captureInvalid('capture output must be a named .png path');
  }
  const configuredPolicy = process.env[SCREENSHOT_PRIVACY_POLICY_ENV];
  const configuredPolicySha256 = process.env[SCREENSHOT_PRIVACY_POLICY_SHA256_ENV];
  const correlation = process.env[SCREENSHOT_CAPTURE_CORRELATION_ENV];
  const capturedAt = process.env[SCREENSHOT_CAPTURED_AT_ENV];
  if (!configuredPolicy || !configuredPolicySha256 || !correlation || !capturedAt) {
    captureInvalid('trusted screenshot policy environment is incomplete');
  }
  if (!/^[0-9a-f]{64}$/u.test(configuredPolicySha256)) {
    captureInvalid('policy SHA-256 is malformed');
  }
  if (!/^[A-Za-z0-9._-]{16,160}$/u.test(correlation)) {
    captureInvalid('capture correlation value is malformed');
  }
  const parsedCapturedAt = new Date(capturedAt);
  if (
    !Number.isFinite(parsedCapturedAt.getTime()) ||
    parsedCapturedAt.toISOString() !== capturedAt
  ) {
    captureInvalid('capture timestamp is malformed');
  }
  const actualPolicySha256 = createHash('sha256').update(configuredPolicy).digest('hex');
  if (actualPolicySha256 !== configuredPolicySha256) {
    captureInvalid('policy bytes do not match the trusted SHA-256');
  }
  let parsedPolicy: unknown;
  try {
    parsedPolicy = JSON.parse(configuredPolicy) as unknown;
  } catch {
    captureInvalid('policy bytes are not JSON');
  }
  const serialized = serializeScreenshotPrivacyPolicy(parsedPolicy);
  if (serialized.json !== configuredPolicy || serialized.sha256 !== configuredPolicySha256) {
    captureInvalid('policy bytes are not canonical');
  }

  const outputScreenshotPath = resolve(screenshotPath);
  const receiptPath = screenshotCaptureReceiptPath(outputScreenshotPath);
  const privacyPath = screenshotPrivacyAttestationPath(outputScreenshotPath);
  const correlationSha256 = createHash('sha256').update(correlation).digest('hex');
  const temporaryScreenshotPath = `${outputScreenshotPath}.${correlationSha256.slice(0, 12)}.tmp`;
  const temporaryReceiptPath = `${receiptPath}.${correlationSha256.slice(0, 12)}.tmp`;
  const ownedPaths = [
    outputScreenshotPath,
    receiptPath,
    privacyPath,
    temporaryScreenshotPath,
    temporaryReceiptPath,
  ];

  try {
    const outputDirectory = dirname(outputScreenshotPath);
    await mkdir(outputDirectory, { recursive: true });
    await assertRealCaptureDirectory(outputDirectory);
    if ((await existingOwnedPaths(ownedPaths)).length > 0) {
      const cleanupFailed = await removeOwnedPaths(ownedPaths);
      if (cleanupFailed || (await existingOwnedPaths(ownedPaths)).length > 0) {
        captureInvalid('unexpected pre-existing screenshot artifact could not be removed');
      }
      captureInvalid('unexpected pre-existing screenshot artifact was removed');
    }
    const declaredMasks = serialized.policy.capture.masks.map((item) => semanticLocator(page, item));
    const declaredCounts = await Promise.all(declaredMasks.map((mask) => mask.count()));
    let masks = declaredMasks;
    let maskAdaptation: readonly string[] | undefined;
    if (
      declaredCounts.some((count) => count < 1 || count > 64) ||
      declaredCounts.reduce((total, count) => total + count, 0) > 256
    ) {
      // #314 (F-E10): a declared anchor absent from THIS page (e.g. the
      // directus admin shell renders no <main>) adapts by masking the
      // page's real landmark set instead of failing. Masking is a hiding
      // operation — the adapted set can only hide MORE than the declared
      // anchors would have, never less. A page with nothing maskable
      // (no landmark resolves in bounds) still fails closed below.
      const adapted = await adaptiveLandmarkMasks(page);
      if (adapted.roles.length === 0) {
        captureInvalid('declared mask locator inventory is missing or exceeds its bound');
      }
      masks = adapted.locators;
      maskAdaptation = adapted.roles;
      if (
        adapted.counts.some((count) => count < 1 || count > 64) ||
        adapted.counts.reduce((total, count) => total + count, 0) > 256
      ) {
        captureInvalid('declared mask locator inventory is missing or exceeds its bound');
      }
    }
    let bytes: Buffer;
    if (serialized.policy.capture.mode === 'approved-region') {
      const region = semanticLocator(page, serialized.policy.capture.region);
      if ((await region.count()) !== 1) {
        captureInvalid('approved capture region did not resolve to exactly one element');
      }
      bytes = await region.screenshot({
        animations: 'disabled',
        caret: 'hide',
        mask: masks,
        maskColor: '#000000',
        scale: 'css',
        type: 'png',
      });
    } else {
      bytes = await page.screenshot({
        animations: 'disabled',
        caret: 'hide',
        fullPage: serialized.policy.capture.fullPage,
        mask: masks,
        maskColor: '#000000',
        scale: 'css',
        type: 'png',
      });
    }
    const browserVersion = page.context().browser()?.version();
    if (!browserVersion || browserVersion.length > 120) {
      captureInvalid('browser version is unavailable or unbounded');
    }
    const receipt: UntrustedScreenshotCaptureReceipt = {
      schemaVersion: 1,
      kind: 'arxic-untrusted-screenshot-capture',
      screenshotFile: basename(outputScreenshotPath),
      screenshotSha256: createHash('sha256').update(bytes).digest('hex'),
      screenshotBytes: bytes.length,
      policySha256: serialized.sha256,
      correlationSha256,
      captureMode: serialized.policy.capture.mode,
      ...(maskAdaptation ? { maskAdaptation } : {}),
      playwrightVersion: '1.62.1',
      browserVersion,
      capturedAt,
    };
    const writes = await Promise.allSettled([
      writeFile(temporaryScreenshotPath, bytes, { flag: 'wx' }),
      writeFile(temporaryReceiptPath, `${JSON.stringify(canonicalize(receipt))}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      }),
    ]);
    const failedWrite = writes.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failedWrite) throw failedWrite.reason;
    await rename(temporaryScreenshotPath, outputScreenshotPath);
    await rename(temporaryReceiptPath, receiptPath);
  } catch (error) {
    const cleanupFailed = await removeOwnedPaths(ownedPaths);
    let remaining = true;
    try {
      remaining = (await existingOwnedPaths(ownedPaths)).length > 0;
    } catch {
      remaining = true;
    }
    if (cleanupFailed || remaining) {
      throw new ScreenshotPrivacyError(
        'ARXIC-SCREENSHOT-CAPTURE-FAILED',
        'capture artifact cleanup could not be completed',
      );
    }
    if (error instanceof ScreenshotPrivacyError) throw error;
    throw new ScreenshotPrivacyError(
      'ARXIC-SCREENSHOT-CAPTURE-FAILED',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function readUntrustedScreenshotCaptureReceipt(
  path: string,
): Promise<UntrustedScreenshotCaptureReceipt> {
  return parseUntrustedScreenshotCaptureReceipt(await readFile(path));
}

export function parseUntrustedScreenshotCaptureReceipt(
  receiptBytes: string | Uint8Array,
): UntrustedScreenshotCaptureReceipt {
  const bytes =
    typeof receiptBytes === 'string'
      ? Buffer.from(receiptBytes, 'utf8')
      : Buffer.from(receiptBytes);
  if (bytes.length < 2 || bytes.length > 16 * 1024) {
    receiptInvalid('capture receipt byte length is invalid');
  }
  let input: unknown;
  try {
    input = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    receiptInvalid('capture receipt is not JSON');
  }
  const value = record(input, 'capture receipt');
  // #314: maskAdaptation is OPTIONAL (present only when masked-page capture
  // adapted its masks) — lift it out before the strict key-set check.
  const { maskAdaptation, ...requiredFields } = value;
  exactKeys(
    requiredFields as Record<string, unknown>,
    [
      'schemaVersion',
      'kind',
      'screenshotFile',
      'screenshotSha256',
      'screenshotBytes',
      'policySha256',
      'correlationSha256',
      'captureMode',
      'playwrightVersion',
      'browserVersion',
      'capturedAt',
    ],
    'capture receipt',
  );
  if (value.schemaVersion !== 1 || value.kind !== 'arxic-untrusted-screenshot-capture') {
    receiptInvalid('capture receipt identity is invalid');
  }
  const screenshotFile = boundedString(value.screenshotFile, 'screenshotFile', 5, 240);
  if (basename(screenshotFile) !== screenshotFile || !screenshotFile.endsWith('.png')) {
    receiptInvalid('capture receipt screenshotFile is invalid');
  }
  for (const field of ['screenshotSha256', 'policySha256', 'correlationSha256'] as const) {
    if (typeof value[field] !== 'string' || !/^[0-9a-f]{64}$/u.test(value[field])) {
      receiptInvalid(`${field} is invalid`);
    }
  }
  if (!Number.isSafeInteger(value.screenshotBytes) || (value.screenshotBytes as number) < 1) {
    receiptInvalid('screenshotBytes is invalid');
  }
  if (value.captureMode !== 'approved-region' && value.captureMode !== 'masked-page') {
    receiptInvalid('captureMode is invalid');
  }
  if (value.maskAdaptation !== undefined) {
    if (!Array.isArray(value.maskAdaptation) || value.maskAdaptation.length < 1) {
      receiptInvalid('maskAdaptation is invalid');
    }
    for (const role of value.maskAdaptation) {
      if (typeof role !== 'string' || !/^[a-z]{2,20}$/u.test(role)) {
        receiptInvalid('maskAdaptation is invalid');
      }
    }
  }
  if (value.playwrightVersion !== '1.62.1') receiptInvalid('playwrightVersion is invalid');
  const browserVersion = boundedString(value.browserVersion, 'browserVersion', 1, 120);
  const receiptCapturedAt = boundedString(value.capturedAt, 'capturedAt', 20, 40);
  const parsedAt = new Date(receiptCapturedAt);
  if (!Number.isFinite(parsedAt.getTime()) || parsedAt.toISOString() !== receiptCapturedAt) {
    receiptInvalid('capturedAt is invalid');
  }
  const receipt = {
    schemaVersion: 1,
    kind: 'arxic-untrusted-screenshot-capture',
    screenshotFile,
    screenshotSha256: value.screenshotSha256,
    screenshotBytes: value.screenshotBytes,
    policySha256: value.policySha256,
    correlationSha256: value.correlationSha256,
    captureMode: value.captureMode,
    ...(maskAdaptation === undefined ? {} : { maskAdaptation }),
    playwrightVersion: '1.62.1',
    browserVersion,
    capturedAt: receiptCapturedAt,
  } as UntrustedScreenshotCaptureReceipt;
  if (`${JSON.stringify(canonicalize(receipt))}\n` !== bytes.toString('utf8')) {
    receiptInvalid('capture receipt is not canonical');
  }
  return deepFreeze(receipt);
}

const roles = new Set([
  'alert',
  'alertdialog',
  'application',
  'article',
  'banner',
  'blockquote',
  'button',
  'caption',
  'cell',
  'checkbox',
  'code',
  'columnheader',
  'combobox',
  'complementary',
  'contentinfo',
  'definition',
  'deletion',
  'dialog',
  'directory',
  'document',
  'emphasis',
  'feed',
  'figure',
  'form',
  'generic',
  'grid',
  'gridcell',
  'group',
  'heading',
  'img',
  'insertion',
  'link',
  'list',
  'listbox',
  'listitem',
  'log',
  'main',
  'marquee',
  'math',
  'meter',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'navigation',
  'none',
  'note',
  'option',
  'paragraph',
  'presentation',
  'progressbar',
  'radio',
  'radiogroup',
  'region',
  'row',
  'rowgroup',
  'rowheader',
  'scrollbar',
  'search',
  'searchbox',
  'separator',
  'slider',
  'spinbutton',
  'status',
  'strong',
  'subscript',
  'superscript',
  'switch',
  'tab',
  'table',
  'tablist',
  'tabpanel',
  'term',
  'textbox',
  'time',
  'timer',
  'toolbar',
  'tooltip',
  'tree',
  'treegrid',
  'treeitem',
]);

function validatePolicy(input: unknown): ScreenshotPrivacyPolicy {
  const policy = record(input, 'policy');
  exactKeys(policy, ['schemaVersion', 'id', 'authority', 'capture'], 'policy');
  if (policy.schemaVersion !== 1) invalid('schemaVersion must equal 1');
  const id = boundedString(policy.id, 'id', 1, 80);
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u.test(id)) {
    invalid('id must be a stable lowercase identifier');
  }
  const authorityInput = record(policy.authority, 'authority');
  exactKeys(authorityInput, ['kind', 'reference', 'recordedAt'], 'authority');
  if (
    authorityInput.kind !== 'declared-human-approval' &&
    authorityInput.kind !== 'repository-policy'
  ) {
    invalid('authority.kind is unsupported');
  }
  const reference = boundedString(authorityInput.reference, 'authority.reference', 1, 240);
  const recordedAt = boundedString(authorityInput.recordedAt, 'authority.recordedAt', 20, 40);
  const parsedRecordedAt = new Date(recordedAt);
  if (
    !Number.isFinite(parsedRecordedAt.getTime()) ||
    parsedRecordedAt.toISOString() !== recordedAt
  ) {
    invalid('authority.recordedAt must be a canonical ISO timestamp');
  }
  const authority: ScreenshotPolicyAuthority = {
    kind: authorityInput.kind,
    reference,
    recordedAt,
  };
  const captureInput = record(policy.capture, 'capture');
  if (captureInput.mode === 'approved-region') {
    exactKeys(captureInput, ['mode', 'region', 'masks'], 'capture');
    const masks = locators(captureInput.masks, 'capture.masks', true);
    return deepFreeze({
      schemaVersion: 1,
      id,
      authority,
      capture: {
        mode: 'approved-region',
        region: locator(captureInput.region, 'capture.region', false),
        masks,
      },
    });
  }
  if (captureInput.mode === 'masked-page') {
    exactKeys(captureInput, ['mode', 'fullPage', 'masks'], 'capture');
    if (typeof captureInput.fullPage !== 'boolean') invalid('capture.fullPage must be boolean');
    const masks = locators(captureInput.masks, 'capture.masks', false) as [
      ScreenshotSemanticLocator,
      ...ScreenshotSemanticLocator[],
    ];
    return deepFreeze({
      schemaVersion: 1,
      id,
      authority,
      capture: {
        mode: 'masked-page',
        fullPage: captureInput.fullPage,
        masks,
      },
    });
  }
  invalid('capture.mode is unsupported');
}

function locators(
  input: unknown,
  subject: string,
  allowEmpty: boolean,
): ScreenshotSemanticLocator[] {
  if (!Array.isArray(input) || input.length > 32 || (!allowEmpty && input.length === 0)) {
    invalid(`${subject} must contain ${allowEmpty ? 'zero to' : 'one to'} 32 locators`);
  }
  return input.map((item, index) => locator(item, `${subject}[${index}]`, true));
}

function locator(
  input: unknown,
  subject: string,
  allowRoleWithoutName: boolean,
): ScreenshotSemanticLocator {
  const value = record(input, subject);
  if (value.kind === 'role') {
    const keys =
      value.name === undefined ? ['kind', 'role', 'exact'] : ['kind', 'role', 'name', 'exact'];
    exactKeys(value, keys, subject);
    const role = boundedString(value.role, `${subject}.role`, 1, 40);
    if (!roles.has(role)) invalid(`${subject}.role is unsupported`);
    if (value.exact !== true) invalid(`${subject}.exact must equal true`);
    if (value.name === undefined) {
      if (!allowRoleWithoutName) invalid(`${subject}.name is required for an approved region`);
      return { kind: 'role', role, exact: true } as const;
    }
    return {
      kind: 'role',
      role,
      name: boundedString(value.name, `${subject}.name`, 1, 160),
      exact: true,
    } as const;
  }
  if (value.kind === 'label') {
    exactKeys(value, ['kind', 'name', 'exact'], subject);
    if (value.exact !== true) invalid(`${subject}.exact must equal true`);
    return {
      kind: 'label',
      name: boundedString(value.name, `${subject}.name`, 1, 160),
      exact: true,
    } as const;
  }
  invalid(`${subject}.kind must use a semantic role or label`);
}

function record(input: unknown, subject: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    invalid(`${subject} must be an object`);
  }
  return input as Record<string, unknown>;
}

function exactKeys(input: Record<string, unknown>, expected: string[], subject: string): void {
  const actual = Object.keys(input).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    invalid(`${subject} has unexpected or missing fields`);
  }
}

function boundedString(input: unknown, subject: string, minimum: number, maximum: number): string {
  if (
    typeof input !== 'string' ||
    input.length < minimum ||
    input.length > maximum ||
    hasControlCharacters(input)
  ) {
    invalid(`${subject} must be a bounded printable string`);
  }
  return input;
}

function hasControlCharacters(input: string): boolean {
  return [...input].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid('policy contains a non-finite number');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  invalid(`policy contains unsupported ${typeof value}`);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function invalid(message: string): never {
  throw new ScreenshotPrivacyError('ARXIC-SCREENSHOT-POLICY-INVALID', message);
}

function captureInvalid(message: string): never {
  throw new ScreenshotPrivacyError('ARXIC-SCREENSHOT-CAPTURE-FAILED', message);
}

function receiptInvalid(message: string): never {
  throw new ScreenshotPrivacyError('ARXIC-SCREENSHOT-RECEIPT-INVALID', message);
}

async function existingOwnedPaths(paths: readonly string[]): Promise<string[]> {
  const results = await Promise.all(
    paths.map(async (path) => {
      try {
        await lstat(path);
        return path;
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          (error.code === 'ENOENT' || error.code === 'ENAMETOOLONG')
        ) {
          return undefined;
        }
        captureInvalid('capture artifact inventory could not be inspected');
      }
    }),
  );
  return results.filter((path): path is string => path !== undefined);
}

async function removeOwnedPaths(paths: readonly string[]): Promise<boolean> {
  return (await Promise.allSettled(paths.map((path) => rm(path, { force: true })))).some(
    ({ status }) => status === 'rejected',
  );
}

async function assertRealCaptureDirectory(path: string): Promise<void> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isDirectory() || (await realpath(path)) !== path) {
      captureInvalid('capture output directory contains symbolic-link indirection');
    }
  } catch (error) {
    if (error instanceof ScreenshotPrivacyError) throw error;
    captureInvalid('capture output directory could not be verified');
  }
}

/**
 * #314 (F-E10): landmark ELEMENTS probed for adaptive masking, in
 * preference order — main first (the standard declared anchor), then the
 * other landmark tags. Element selectors (not getByRole) because ARIA maps
 * <form> to role form ONLY when it has an accessible name: the directus
 * login form (probed live) matches locator('form') === 1 while
 * getByRole('form') === 0, and every landmark on its shell is nameless.
 */
// Literal landmark-tag selectors (kept literal — never content-addressed —
// so the compile-time non-semantic locator gate can review the exact set).
const ADAPTIVE_MASK_PROBES = [
  ['main', (page: Page) => page.locator('main')],
  ['article', (page: Page) => page.locator('article')],
  ['form', (page: Page) => page.locator('form')],
  ['aside', (page: Page) => page.locator('aside')],
  ['nav', (page: Page) => page.locator('nav')],
  ['header', (page: Page) => page.locator('header')],
  ['footer', (page: Page) => page.locator('footer')],
] as const;

async function adaptiveLandmarkMasks(
  page: Page,
): Promise<{ locators: Locator[]; roles: string[]; counts: number[] }> {
  const locators: Locator[] = [];
  const roles: string[] = [];
  const counts: number[] = [];
  let total = 0;
  for (const [role, locate] of ADAPTIVE_MASK_PROBES) {
    if (total >= 256 || locators.length >= 64) break;
    const locator = locate(page);
    const count = await locator.count();
    if (count < 1 || count > 64) continue;
    locators.push(locator);
    roles.push(role);
    counts.push(count);
    total += count;
  }
  return { locators, roles, counts };
}

function semanticLocator(page: Page, locator: ScreenshotSemanticLocator): Locator {
  if (locator.kind === 'label') {
    return page.getByLabel(locator.name, { exact: locator.exact });
  }
  return page.getByRole(locator.role as Parameters<Page['getByRole']>[0], {
    ...(locator.name ? { name: locator.name } : {}),
    exact: locator.exact,
  });
}
