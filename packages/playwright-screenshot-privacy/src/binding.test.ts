import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  assertTrustedScreenshotCaptureBinding,
  establishTrustedScreenshotCaptureBinding,
  missingScreenshotCheckpointsInBinding,
  screenshotPrivacyRuntimeSource,
} from './index';

const directories: string[] = [];
const expectedSpec = [
  "import { capturePolicyScreenshot } from '../fixtures/screenshot-privacy';",
  "import { test } from '../fixtures/workflow.fixture';",
  "test('safe', async ({ page }) => {",
  "  await capturePolicyScreenshot(page, 'artifacts/screenshots/home.png');",
  '});',
  '',
].join('\n');
const trustedSourceContents = {
  'fixtures/screenshot-privacy.ts': screenshotPrivacyRuntimeSource(),
  'fixtures/workflow.fixture.ts': 'export const test = true;\n',
  'playwright.config.ts': 'export default {};\n',
  'tests/workflow.spec.ts': expectedSpec,
} as const;
const baseInput = {
  specPath: 'tests/workflow.spec.ts',
  runtimePath: 'fixtures/screenshot-privacy.ts',
  expectedSpec,
  allowedSourcePaths: [
    'tests/workflow.spec.ts',
    'fixtures/workflow.fixture.ts',
    'fixtures/screenshot-privacy.ts',
    'playwright.config.ts',
  ],
  trustedSourceContents,
  expectedScreenshots: ['artifacts/screenshots/home.png'],
} as const;

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('trusted compiled screenshot binding', () => {
  test.each([
    [
      'modified spec',
      'tests/workflow.spec.ts',
      `${expectedSpec}\npage.screenshot({ path: 'raw.png' });\n`,
    ],
    ['forged runtime', 'fixtures/screenshot-privacy.ts', 'export const forged = true;\n'],
    [
      'unexpected runnable source',
      'tests/extra.spec.ts',
      "page['screenshot']({ path: 'raw.png' });\n",
    ],
    ['modified config', 'playwright.config.ts', 'export default { reporter: "./forged" };\n'],
  ])(
    'rejects %s even when a caller could update its declared artifact hash',
    async (_label, path, content) => {
      const directory = await fixtureDirectory();
      await put(directory, path, content);

      await expect(
        establishTrustedScreenshotCaptureBinding({ testDirectory: directory, ...baseInput }),
      ).rejects.toThrow(/ARXIC-SCREENSHOT-BINDING/u);
    },
  );

  test.each<[readonly string[]]>([
    [['../escape.png']],
    [['artifacts/screenshots/home.jpg']],
    [['artifacts/screenshots/home.png', 'artifacts/screenshots/home.png']],
  ])('rejects an invalid expected output inventory: %j', async (expectedScreenshots) => {
    const directory = await fixtureDirectory();
    await expect(
      establishTrustedScreenshotCaptureBinding({
        testDirectory: directory,
        ...baseInput,
        expectedScreenshots,
      }),
    ).rejects.toThrow(/ARXIC-SCREENSHOT-BINDING/u);
  });

  test('binds a zero-screenshot spec when the workflow has no required transitions', async () => {
    const directory = await fixtureDirectory();
    const noScreenshotSpec = [
      "import { test } from '../fixtures/workflow.fixture';",
      "test('no required transitions', async () => {});",
      '',
    ].join('\n');
    await put(directory, 'tests/workflow.spec.ts', noScreenshotSpec);

    await expect(
      establishTrustedScreenshotCaptureBinding({
        testDirectory: directory,
        ...baseInput,
        expectedSpec: noScreenshotSpec,
        trustedSourceContents: {
          ...trustedSourceContents,
          'tests/workflow.spec.ts': noScreenshotSpec,
        },
        expectedScreenshots: [],
      }),
    ).resolves.toMatchObject({ expectedScreenshots: [] });
  });

  test('binds exact source bytes and detects post-bind drift', async () => {
    const directory = await fixtureDirectory();
    const binding = await establishTrustedScreenshotCaptureBinding({
      testDirectory: directory,
      ...baseInput,
    });

    expect(binding).toMatchObject({
      spec: { path: baseInput.specPath, sha256: expect.stringMatching(/^[0-9a-f]{64}$/u) },
      runtime: { path: baseInput.runtimePath, sha256: expect.stringMatching(/^[0-9a-f]{64}$/u) },
      expectedScreenshots: baseInput.expectedScreenshots,
    });
    await expect(
      assertTrustedScreenshotCaptureBinding(directory, binding),
    ).resolves.toBeUndefined();
    await put(directory, baseInput.specPath, `${expectedSpec}// post-bind drift\n`);
    await expect(assertTrustedScreenshotCaptureBinding(directory, binding)).rejects.toThrow(
      /ARXIC-SCREENSHOT-BINDING/u,
    );

    const secondDirectory = await fixtureDirectory();
    const secondBinding = await establishTrustedScreenshotCaptureBinding({
      testDirectory: secondDirectory,
      ...baseInput,
    });
    await put(secondDirectory, 'playwright.config.ts', 'export default { workers: 2 };\n');
    await expect(
      assertTrustedScreenshotCaptureBinding(secondDirectory, secondBinding),
    ).rejects.toThrow(/ARXIC-SCREENSHOT-BINDING/u);
  });

  test('maps checkpoints from bound source paths without treating semantic words as privacy signals', () => {
    const binding = {
      spec: { path: 'tests/workflow.spec.ts', sha256: 'a'.repeat(64) },
      runtime: { path: 'fixtures/screenshot-privacy.ts', sha256: 'b'.repeat(64) },
      sources: [],
      allowedSourcePaths: [],
      expectedScreenshots: [
        'artifacts/screenshots/step-1-login-page-home.png',
        'artifacts/screenshots/step-2-home-change-password-page.png',
      ],
    } as const;

    expect(
      missingScreenshotCheckpointsInBinding(binding, ['home', 'change password page', 'signed-in']),
    ).toEqual(['signed-in']);
  });
});

async function fixtureDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-screenshot-binding-'));
  directories.push(directory);
  await Promise.all([
    put(directory, baseInput.specPath, expectedSpec),
    put(directory, baseInput.runtimePath, trustedSourceContents['fixtures/screenshot-privacy.ts']),
    put(
      directory,
      'fixtures/workflow.fixture.ts',
      trustedSourceContents['fixtures/workflow.fixture.ts'],
    ),
    put(directory, 'playwright.config.ts', trustedSourceContents['playwright.config.ts']),
  ]);
  return directory;
}

async function put(directory: string, path: string, content: string): Promise<void> {
  await mkdir(dirname(join(directory, path)), { recursive: true });
  await writeFile(join(directory, path), content, 'utf8');
}
