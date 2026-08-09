import { createHash } from 'node:crypto';
import { lstat, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  assertTrustedScreenshotCaptureBinding,
  expectedScreenshotPathsFromTrustedSpec,
} from './binding';
import type { TrustedScreenshotCaptureBinding } from './binding';
import { inspectPng } from './png';
import { screenshotPrivacyRuntimeSource } from './runtime-source';
import {
  readBoundedRegularFile,
  readRegularFilePrefix,
  walkStableWorkspace,
} from './safe-filesystem';
import {
  parseUntrustedScreenshotCaptureReceipt,
  screenshotCaptureReceiptPath,
  screenshotPrivacyAttestationPath,
  ScreenshotPrivacyError,
  serializeScreenshotPrivacyPolicy,
} from './standalone-runtime';
import type { ScreenshotPrivacyPolicy } from './standalone-runtime';

export type ScreenshotArtifactLike = Readonly<{
  kind: string;
  path: string;
  sha256: string;
}>;

export type RetainedScreenshot = Readonly<{
  screenshot: ScreenshotArtifactLike;
  provenance: ScreenshotArtifactLike;
}>;

export type ScreenshotPrivacyAttestation = Readonly<{
  schemaVersion: 1;
  kind: 'arxic-screenshot-privacy-attestation';
  attestedBy: '@arxic/verifier' | '@arxic/m0-pipeline' | '@arxic/orchestrator-langgraph';
  attestedAt: string;
  screenshot: Readonly<{
    file: string;
    sha256: string;
    bytes: number;
    width: number;
    height: number;
  }>;
  policy: ScreenshotPrivacyPolicy;
  policySha256: string;
  capture: Readonly<{
    sourcePath: string;
    mode: 'approved-region' | 'masked-page';
    playwrightVersion: '1.62.1';
    browserVersion: string;
    capturedAt: string;
    receiptSha256: string;
    correlationSha256: string;
  }>;
  binding: Readonly<{
    spec: Readonly<{ path: string; sha256: string }>;
    runtime: Readonly<{ path: string; sha256: string }>;
    sources: readonly Readonly<{ path: string; sha256: string }>[];
  }>;
}>;

export async function retainPolicyAttestedScreenshots(input: {
  testDirectory: string;
  sourceRoots: readonly string[];
  destinationDirectory: string;
  binding: TrustedScreenshotCaptureBinding;
  policy: ScreenshotPrivacyPolicy;
  correlation: string;
  attester: '@arxic/verifier' | '@arxic/m0-pipeline' | '@arxic/orchestrator-langgraph';
  attestedAt: string;
  retainedName?: (sourcePath: string, index: number) => string;
}): Promise<readonly RetainedScreenshot[]> {
  const retainedPaths: string[] = [];
  const validatedSourceRoots: ValidatedSourceRoot[] = [];
  let retentionSucceeded = false;
  let primaryFailureCode: string | undefined;
  const testDirectory = resolve(input.testDirectory);
  const destinationDirectory = resolve(input.destinationDirectory);
  const sourceRoots = input.sourceRoots.map((path) => safeRelativePath(path, 'source root'));
  const expectedScreenshots = input.binding.expectedScreenshots;
  const expectedReceipts = expectedScreenshots.map((path) => `${path}.capture.json`);
  const expectedInventory = [...expectedScreenshots, ...expectedReceipts].sort();
  const cleanupPaths = new Set([
    ...expectedScreenshots,
    ...expectedReceipts,
    ...expectedScreenshots.map((path) => `${path}.privacy.json`),
  ]);
  try {
    validateTimestamp(input.attestedAt, 'attestedAt');
    if (!/^[A-Za-z0-9._-]{16,160}$/u.test(input.correlation)) {
      attestationInvalid('capture correlation value is malformed');
    }
    const serializedPolicy = serializeScreenshotPrivacyPolicy(input.policy);
    await assertRealDirectory(testDirectory, 'test directory');
    if (!sameStrings([...sourceRoots].sort(), [...ACTION_OWNED_SOURCE_ROOTS].sort())) {
      inventoryInvalid('source roots must be the fixed action-owned generated output roots');
    }
    for (const path of expectedScreenshots) {
      if (!sourceRoots.some((root) => path === root || path.startsWith(`${root}/`))) {
        inventoryInvalid(`expected screenshot is outside source roots: ${path}`);
      }
    }
    const resolvedSourceRoots = sourceRoots.map((root) => safeResolve(testDirectory, root));
    for (const [index, resolvedRoot] of resolvedSourceRoots.entries()) {
      const root = sourceRoots[index]!;
      const validatedRoot = await validateOwnedSourceRoot(resolvedRoot, root);
      if (pathsOverlap(destinationDirectory, resolvedRoot)) {
        inventoryInvalid('destination directory must be outside screenshot source roots');
      }
      if (
        sourceRoots.some(
          (candidate, candidateIndex) =>
            candidateIndex !== index &&
            (candidate === root ||
              candidate.startsWith(`${root}/`) ||
              root.startsWith(`${candidate}/`)),
        )
      ) {
        inventoryInvalid('screenshot source roots must not overlap');
      }
      if (
        input.binding.allowedSourcePaths.some(
          (path) => path === root || path.startsWith(`${root}/`),
        )
      ) {
        inventoryInvalid('screenshot source root overlaps trusted runnable source');
      }
      validatedSourceRoots.push(validatedRoot);
    }
    await assertSafeDestinationParent(destinationDirectory);
    await assertTrustedScreenshotCaptureBinding(testDirectory, input.binding);
    const destinationInventory = await relatedInventory(destinationDirectory, destinationDirectory);
    if (destinationInventory.length > 0) {
      await Promise.all(destinationInventory.map(({ absolute }) => rm(absolute, { force: true })));
      inventoryInvalid('destination contained unexpected pre-existing image artifacts');
    }
    const initialInventory = await sourceInventory(testDirectory);
    for (const item of initialInventory) cleanupPaths.add(item.relative);
    assertNoArtifactSymlinks(initialInventory);
    if (
      !sameStrings(initialInventory.map(({ relative: path }) => path).sort(), expectedInventory)
    ) {
      inventoryInvalid('source image inventory differs from the exact bound output set');
    }

    await mkdir(destinationDirectory, { recursive: true });
    const retained: RetainedScreenshot[] = [];
    for (const [index, relativeScreenshot] of expectedScreenshots.entries()) {
      const sourceScreenshot = safeResolve(testDirectory, relativeScreenshot);
      const sourceReceipt = screenshotCaptureReceiptPath(sourceScreenshot);
      const [bytes, receiptBytes] = await Promise.all([
        boundedFileBytes(sourceScreenshot, 16 * 1024 * 1024, attestationInvalid),
        boundedFileBytes(sourceReceipt, 16 * 1024, attestationInvalid),
      ]);
      const receipt = parseUntrustedScreenshotCaptureReceipt(receiptBytes);
      const inspected = inspectPng(bytes);
      const screenshotSha256 = sha256(bytes);
      const correlationSha256 = sha256(input.correlation);
      if (
        receipt.screenshotFile !== basename(sourceScreenshot) ||
        receipt.screenshotSha256 !== screenshotSha256 ||
        receipt.screenshotBytes !== bytes.length ||
        receipt.policySha256 !== serializedPolicy.sha256 ||
        receipt.correlationSha256 !== correlationSha256 ||
        receipt.captureMode !== serializedPolicy.policy.capture.mode
      ) {
        attestationInvalid(`untrusted capture receipt does not match ${relativeScreenshot}`);
      }
      const targetName = input.retainedName
        ? input.retainedName(relativeScreenshot, index)
        : `${String(index + 1).padStart(3, '0')}-screenshot.png`;
      if (
        basename(targetName) !== targetName ||
        !targetName.endsWith('.png') ||
        targetName.length > 240
      ) {
        attestationInvalid('retained screenshot name is invalid');
      }
      const targetScreenshot = join(destinationDirectory, targetName);
      const targetProvenance = screenshotPrivacyAttestationPath(targetScreenshot);
      const attestation: ScreenshotPrivacyAttestation = {
        schemaVersion: 1,
        kind: 'arxic-screenshot-privacy-attestation',
        attestedBy: input.attester,
        attestedAt: input.attestedAt,
        screenshot: {
          file: targetName,
          sha256: screenshotSha256,
          bytes: inspected.bytes,
          width: inspected.width,
          height: inspected.height,
        },
        policy: serializedPolicy.policy,
        policySha256: serializedPolicy.sha256,
        capture: {
          sourcePath: relativeScreenshot,
          mode: receipt.captureMode,
          playwrightVersion: receipt.playwrightVersion,
          browserVersion: receipt.browserVersion,
          capturedAt: receipt.capturedAt,
          receiptSha256: sha256(receiptBytes),
          correlationSha256,
        },
        binding: {
          spec: input.binding.spec,
          runtime: input.binding.runtime,
          sources: input.binding.sources,
        },
      };
      const provenanceBytes = canonicalJson(attestation);
      retainedPaths.push(targetScreenshot, targetProvenance);
      const writes = await Promise.allSettled([
        writeFile(targetScreenshot, bytes, { flag: 'wx' }),
        writeFile(targetProvenance, provenanceBytes, { encoding: 'utf8', flag: 'wx' }),
      ]);
      const failedWrite = writes.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (failedWrite) throw failedWrite.reason;
      retained.push({
        screenshot: { kind: 'screenshot', path: targetScreenshot, sha256: screenshotSha256 },
        provenance: {
          kind: 'screenshot-privacy-report',
          path: targetProvenance,
          sha256: sha256(provenanceBytes),
        },
      });
    }
    await assertTrustedScreenshotCaptureBinding(testDirectory, input.binding);
    const finalInventory = await sourceInventory(testDirectory);
    for (const item of finalInventory) cleanupPaths.add(item.relative);
    assertNoArtifactSymlinks(finalInventory);
    if (!sameStrings(finalInventory.map(({ relative: path }) => path).sort(), expectedInventory)) {
      inventoryInvalid('source image inventory changed during attestation');
    }
    retentionSucceeded = true;
    return Object.freeze(retained);
  } catch (error) {
    await Promise.allSettled(retainedPaths.map((path) => rm(path, { force: true })));
    if (error instanceof ScreenshotPrivacyError) {
      primaryFailureCode = error.code;
      throw error;
    }
    primaryFailureCode = 'ARXIC-SCREENSHOT-ATTESTATION-INVALID';
    throw new ScreenshotPrivacyError(
      'ARXIC-SCREENSHOT-ATTESTATION-INVALID',
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    try {
      const remaining = await sourceInventory(testDirectory);
      for (const item of remaining) cleanupPaths.add(item.relative);
    } catch {
      // Explicit expected paths are still removed below; the action remains blocked.
    }
    const cleanupResults = await Promise.allSettled(
      [...cleanupPaths].map((path) => rm(safeResolve(testDirectory, path), { force: true })),
    );
    let cleanupIncomplete = cleanupResults.some(({ status }) => status === 'rejected');
    if (!retentionSucceeded || cleanupIncomplete) {
      const purgeResults = await Promise.allSettled(
        validatedSourceRoots.map((root) => purgeValidatedSourceRoot(root)),
      );
      cleanupIncomplete ||= purgeResults.some(({ status }) => status === 'rejected');
    }
    try {
      cleanupIncomplete ||= (await sourceInventory(testDirectory)).length > 0;
    } catch {
      cleanupIncomplete = true;
    }
    if (cleanupIncomplete) {
      await Promise.allSettled(retainedPaths.map((path) => rm(path, { force: true })));
      cleanupInvalid(primaryFailureCode);
    }
  }
}

export async function readScreenshotPrivacyAttestation(
  path: string,
): Promise<ScreenshotPrivacyAttestation> {
  return parseScreenshotPrivacyAttestation(
    await boundedFileBytes(path, 64 * 1024, attestationInvalid),
  );
}

export function parseScreenshotPrivacyAttestation(
  input: string | Uint8Array,
): ScreenshotPrivacyAttestation {
  const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
  if (bytes.length < 2 || bytes.length > 64 * 1024)
    attestationInvalid('provenance byte length is invalid');
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    attestationInvalid('provenance is not JSON');
  }
  const root = record(parsed, 'provenance');
  exactKeys(
    root,
    [
      'schemaVersion',
      'kind',
      'attestedBy',
      'attestedAt',
      'screenshot',
      'policy',
      'policySha256',
      'capture',
      'binding',
    ],
    'provenance',
  );
  if (root.schemaVersion !== 1 || root.kind !== 'arxic-screenshot-privacy-attestation') {
    attestationInvalid('provenance identity is invalid');
  }
  if (
    !['@arxic/verifier', '@arxic/m0-pipeline', '@arxic/orchestrator-langgraph'].includes(
      String(root.attestedBy),
    )
  ) {
    attestationInvalid('provenance attester is invalid');
  }
  const attestedAt = string(root.attestedAt, 'attestedAt', 20, 40);
  validateTimestamp(attestedAt, 'attestedAt');
  const screenshotInput = record(root.screenshot, 'screenshot');
  exactKeys(screenshotInput, ['file', 'sha256', 'bytes', 'width', 'height'], 'screenshot');
  const file = string(screenshotInput.file, 'screenshot.file', 5, 300);
  if (basename(file) !== file || !file.endsWith('.png'))
    attestationInvalid('screenshot.file is invalid');
  const screenshotSha256 = digest(screenshotInput.sha256, 'screenshot.sha256');
  const screenshotBytes = positiveInteger(
    screenshotInput.bytes,
    'screenshot.bytes',
    16 * 1024 * 1024,
  );
  const width = positiveInteger(screenshotInput.width, 'screenshot.width', 8192);
  const height = positiveInteger(screenshotInput.height, 'screenshot.height', 8192);
  const serializedPolicy = serializeScreenshotPrivacyPolicy(root.policy);
  const policySha256 = digest(root.policySha256, 'policySha256');
  if (serializedPolicy.sha256 !== policySha256) attestationInvalid('policy SHA-256 is mismatched');
  const captureInput = record(root.capture, 'capture');
  exactKeys(
    captureInput,
    [
      'sourcePath',
      'mode',
      'playwrightVersion',
      'browserVersion',
      'capturedAt',
      'receiptSha256',
      'correlationSha256',
    ],
    'capture',
  );
  const sourcePath = safeRelativePath(
    string(captureInput.sourcePath, 'capture.sourcePath', 5, 300),
    'capture.sourcePath',
  );
  if (!sourcePath.endsWith('.png')) attestationInvalid('capture.sourcePath is not a PNG path');
  if (captureInput.mode !== serializedPolicy.policy.capture.mode)
    attestationInvalid('capture mode is mismatched');
  if (captureInput.playwrightVersion !== '1.62.1')
    attestationInvalid('Playwright version is invalid');
  const browserVersion = string(captureInput.browserVersion, 'capture.browserVersion', 1, 120);
  const capturedAt = string(captureInput.capturedAt, 'capture.capturedAt', 20, 40);
  validateTimestamp(capturedAt, 'capture.capturedAt');
  const receiptSha256 = digest(captureInput.receiptSha256, 'capture.receiptSha256');
  const correlationSha256 = digest(captureInput.correlationSha256, 'capture.correlationSha256');
  const bindingInput = record(root.binding, 'binding');
  exactKeys(bindingInput, ['spec', 'runtime', 'sources'], 'binding');
  const spec = bindingEntry(bindingInput.spec, 'binding.spec');
  const runtime = bindingEntry(bindingInput.runtime, 'binding.runtime');
  if (
    spec.path === runtime.path ||
    !spec.path.endsWith('.spec.ts') ||
    basename(runtime.path) !== 'screenshot-privacy.ts'
  ) {
    attestationInvalid('spec and runtime binding paths are invalid');
  }
  if (
    !Array.isArray(bindingInput.sources) ||
    bindingInput.sources.length < 2 ||
    bindingInput.sources.length > 256
  ) {
    attestationInvalid('binding.sources is not a bounded array');
  }
  const sources = bindingInput.sources.map((entry, index) =>
    bindingEntry(entry, `binding.sources[${index}]`),
  );
  if (
    new Set(sources.map(({ path }) => path)).size !== sources.length ||
    !sameStrings(
      sources.map(({ path }) => path),
      sources.map(({ path }) => path).sort(compare),
    )
  ) {
    attestationInvalid('binding.sources must be unique and sorted');
  }
  const boundSpec = sources.find(({ path }) => path === spec.path);
  const boundRuntime = sources.find(({ path }) => path === runtime.path);
  if (boundSpec?.sha256 !== spec.sha256 || boundRuntime?.sha256 !== runtime.sha256) {
    attestationInvalid('spec and runtime are not present in the complete source binding');
  }
  const attestation: ScreenshotPrivacyAttestation = {
    schemaVersion: 1,
    kind: 'arxic-screenshot-privacy-attestation',
    attestedBy: root.attestedBy as ScreenshotPrivacyAttestation['attestedBy'],
    attestedAt,
    screenshot: { file, sha256: screenshotSha256, bytes: screenshotBytes, width, height },
    policy: serializedPolicy.policy,
    policySha256,
    capture: {
      sourcePath,
      mode: captureInput.mode as 'approved-region' | 'masked-page',
      playwrightVersion: '1.62.1',
      browserVersion,
      capturedAt,
      receiptSha256,
      correlationSha256,
    },
    binding: { spec, runtime, sources },
  };
  if (canonicalJson(attestation) !== bytes.toString('utf8'))
    attestationInvalid('provenance is not canonical');
  return deepFreeze(attestation);
}

export async function validateScreenshotArtifactSet(input: {
  artifacts: readonly ScreenshotArtifactLike[];
  baseDirectory?: string;
}): Promise<void> {
  if (input.artifacts.length > 4096) attestationInvalid('artifact inventory exceeds its bound');
  const resolvedArtifactPaths = input.artifacts.map(({ path }) =>
    resolve(artifactPath(path, input.baseDirectory)),
  );
  if (new Set(resolvedArtifactPaths).size !== resolvedArtifactPaths.length) {
    attestationInvalid('artifact inventory contains duplicate filesystem paths');
  }
  if (input.artifacts.some(({ path }) => /\.capture\.json$/iu.test(path))) {
    attestationInvalid('artifact inventory contains an untrusted screenshot capture receipt');
  }
  await Promise.all(
    input.artifacts.map((artifact) =>
      assertRegularArtifactPath(artifactPath(artifact.path, input.baseDirectory)),
    ),
  );
  const magicImages = await Promise.all(
    input.artifacts.map(async (artifact) => ({
      artifact,
      image: await hasImageMagic(artifactPath(artifact.path, input.baseDirectory)),
    })),
  );
  if (
    magicImages.some(
      ({ artifact, image }) =>
        image && (artifact.kind !== 'screenshot' || !artifact.path.endsWith('.png')),
    )
  ) {
    attestationInvalid('artifact inventory contains disguised or mislabeled image bytes');
  }
  const screenshots = input.artifacts.filter(
    ({ kind, path }, index) =>
      kind === 'screenshot' ||
      /\.(?:png|jpe?g|webp)$/iu.test(path) ||
      magicImages[index]?.image === true,
  );
  const provenances = input.artifacts.filter(
    ({ kind, path }) =>
      kind === 'screenshot-privacy-report' ||
      kind === 'screenshot-provenance' ||
      /\.privacy\.json$/iu.test(path),
  );
  if (screenshots.length === 0 && provenances.length === 0) return;
  if (
    screenshots.some(({ kind, path }) => kind !== 'screenshot' || !path.endsWith('.png')) ||
    provenances.some(
      ({ kind, path }) =>
        (kind !== 'screenshot-privacy-report' && kind !== 'screenshot-provenance') ||
        !path.endsWith('.png.privacy.json'),
    ) ||
    screenshots.length !== provenances.length
  ) {
    attestationInvalid('screenshot artifact set contains raw, mislabeled, or orphaned artifacts');
  }
  const runtimeDigest = sha256(screenshotPrivacyRuntimeSource());
  const sourceBytes = new Map<string, Buffer>();
  const captureBindings = new Set<string>();
  for (const screenshot of screenshots) {
    const provenance = provenances.find(({ path }) => path === `${screenshot.path}.privacy.json`);
    if (!provenance) attestationInvalid(`screenshot lacks adjacent provenance: ${screenshot.path}`);
    const [screenshotBytes, provenanceBytes] = await Promise.all([
      artifactBytes(screenshot, input.baseDirectory, 16 * 1024 * 1024),
      artifactBytes(provenance, input.baseDirectory, 64 * 1024),
    ]);
    const inspected = inspectPng(screenshotBytes);
    const attestation = parseScreenshotPrivacyAttestation(provenanceBytes);
    if (
      attestation.screenshot.file !== basename(screenshot.path) ||
      attestation.screenshot.sha256 !== screenshot.sha256 ||
      attestation.screenshot.bytes !== screenshotBytes.length ||
      attestation.screenshot.width !== inspected.width ||
      attestation.screenshot.height !== inspected.height ||
      sha256(provenanceBytes) !== provenance.sha256 ||
      attestation.binding.runtime.sha256 !== runtimeDigest
    ) {
      attestationInvalid(`screenshot provenance does not bind ${screenshot.path}`);
    }
    for (const [kind, binding] of attestation.binding.sources.map(
      (source) => ['source', source] as const,
    )) {
      if (!/\.(?:[cm]?[jt]s)$/u.test(binding.path)) {
        attestationInvalid(`bound runnable source has an unsupported extension: ${binding.path}`);
      }
      const matches = input.artifacts.filter(
        (artifact) =>
          artifact.path === binding.path ||
          artifact.path.endsWith(`/${binding.path}`) ||
          artifact.path.endsWith(`\\${binding.path.replaceAll('/', '\\')}`),
      );
      if (matches.length !== 1 || matches[0]!.sha256 !== binding.sha256) {
        attestationInvalid(`${kind} binding is absent, ambiguous, or mismatched`);
      }
      let bytes = sourceBytes.get(matches[0]!.path);
      if (!bytes) {
        bytes = await artifactBytes(matches[0]!, input.baseDirectory, 1024 * 1024);
        sourceBytes.set(matches[0]!.path, bytes);
      }
      if (
        binding.path !== attestation.binding.runtime.path &&
        (/\.screenshot\s*\(/u.test(bytes.toString('utf8')) ||
          /\[['"]screenshot['"]\]\s*\(/u.test(bytes.toString('utf8')))
      ) {
        attestationInvalid(`raw screenshot API appears in bound source: ${binding.path}`);
      }
    }
    const specArtifact = input.artifacts.find(
      ({ path }) =>
        path === attestation.binding.spec.path ||
        path.endsWith(`/${attestation.binding.spec.path}`) ||
        path.endsWith(`\\${attestation.binding.spec.path.replaceAll('/', '\\')}`),
    );
    const specBytes = specArtifact ? sourceBytes.get(specArtifact.path) : undefined;
    const expectedSources = specBytes
      ? expectedScreenshotPathsFromTrustedSpec(specBytes.toString('utf8'))
      : [];
    if (!specBytes || !expectedSources.includes(attestation.capture.sourcePath)) {
      attestationInvalid('bound spec does not contain a trusted screenshot capture call');
    }
    const captureBinding = [
      attestation.binding.spec.sha256,
      attestation.capture.correlationSha256,
      attestation.capture.sourcePath,
    ].join(':');
    if (captureBindings.has(captureBinding)) {
      attestationInvalid('artifact inventory duplicates a bound screenshot capture');
    }
    captureBindings.add(captureBinding);
  }
}

type InventoryItem = {
  relative: string;
  absolute: string;
  ownership: 'workspace-file' | 'symbolic-link';
};
type TraversalState = { images: number };
type ValidatedSourceRoot = {
  path: string;
  identity?: Readonly<{ device: number; inode: number }>;
};

const ACTION_OWNED_SOURCE_ROOTS = Object.freeze(['artifacts', 'test-results'] as const);

async function sourceInventory(testDirectory: string): Promise<InventoryItem[]> {
  const state: TraversalState = { images: 0 };
  return (
    await relatedInventory(resolve(testDirectory), resolve(testDirectory), state, false)
  ).sort((left, right) => compare(left.relative, right.relative));
}

async function relatedInventory(
  directory: string,
  base: string,
  state: TraversalState = { images: 0 },
  allowMissing = true,
): Promise<InventoryItem[]> {
  const found: InventoryItem[] = [];
  await walkStableWorkspace(directory, {
    allowMissing,
    maximumDepth: 16,
    maximumEntriesPerDirectory: 1024,
    maximumTotalEntries: 4096,
    onFailure: inventoryInvalid,
    onEntry: async (entry) => {
      // Ownership is physical, not name-based: every real directory rooted in the
      // workspace is traversed, including local dependency and VCS-shaped trees.
      // Symlink targets are never followed, so an external dependency tree remains
      // outside this inventory. Artifact-named links are still owned entries and
      // must be removed rather than accepted as screenshot output.
      if (entry.kind === 'symbolic-link') {
        if (!isImageArtifact(entry.name)) return;
        addInventoryItem(found, state, {
          relative: normalizedRelative(base, entry.absolutePath),
          absolute: entry.absolutePath,
          ownership: 'symbolic-link',
        });
        return;
      }
      if (isImageArtifact(entry.name) || (await hasImageMagicBytes(await entry.readPrefix(12)))) {
        addInventoryItem(found, state, {
          relative: normalizedRelative(base, entry.absolutePath),
          absolute: entry.absolutePath,
          ownership: 'workspace-file',
        });
      }
    },
  });
  return found;
}

function addInventoryItem(
  inventory: InventoryItem[],
  state: TraversalState,
  item: InventoryItem,
): void {
  state.images += 1;
  if (state.images > 256) inventoryInvalid('image artifact inventory exceeds its bound');
  inventory.push(item);
}

function assertNoArtifactSymlinks(inventory: readonly InventoryItem[]): void {
  const link = inventory.find(({ ownership }) => ownership === 'symbolic-link');
  if (link) {
    inventoryInvalid(`image artifact inventory contains a symbolic link: ${link.relative}`);
  }
}

function isImageArtifact(path: string): boolean {
  return /\.(?:png|jpe?g|webp)$/iu.test(path) || /\.(?:capture|privacy)\.json$/iu.test(path);
}

async function hasImageMagic(
  path: string,
  onFailure: (message: string) => never = attestationInvalid,
): Promise<boolean> {
  const bytes = await readRegularFilePrefix(path, 12, { onFailure });
  return hasImageMagicBytes(bytes);
}

function hasImageMagicBytes(bytes: Buffer): boolean {
  return (
    bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ||
    (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    (bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
      bytes.subarray(8, 12).toString('ascii') === 'WEBP')
  );
}

async function assertRealDirectory(
  path: string,
  subject: string,
  allowMissing = false,
): Promise<void> {
  try {
    const metadata = await lstat(path);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isDirectory() ||
      (await realpath(path)) !== resolve(path)
    ) {
      inventoryInvalid(`${subject} is not a real directory`);
    }
  } catch (error) {
    if (error instanceof ScreenshotPrivacyError) throw error;
    if (
      allowMissing &&
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return;
    }
    inventoryInvalid(`${subject} is unavailable`);
  }
}

async function assertSafeDestinationParent(destination: string): Promise<void> {
  const parent = dirname(destination);
  try {
    if ((await realpath(parent)) !== resolve(parent)) {
      inventoryInvalid('destination parent contains a symbolic-link indirection');
    }
    try {
      const metadata = await lstat(destination);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        inventoryInvalid('destination is not a real directory');
      }
    } catch (error) {
      if (error instanceof ScreenshotPrivacyError) throw error;
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') {
        throw error;
      }
    }
  } catch (error) {
    if (error instanceof ScreenshotPrivacyError) throw error;
    inventoryInvalid('destination parent is unavailable');
  }
}

async function validateOwnedSourceRoot(
  path: string,
  relativePath: string,
): Promise<ValidatedSourceRoot> {
  try {
    const metadata = await lstat(path);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isDirectory() ||
      (await realpath(path)) !== resolve(path)
    ) {
      inventoryInvalid(`source root ${relativePath} is not a real directory`);
    }
    return {
      path,
      identity: Object.freeze({ device: metadata.dev, inode: metadata.ino }),
    };
  } catch (error) {
    if (error instanceof ScreenshotPrivacyError) throw error;
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return { path };
    }
    inventoryInvalid(`source root ${relativePath} is unavailable`);
  }
}

async function purgeValidatedSourceRoot(root: ValidatedSourceRoot): Promise<void> {
  try {
    const metadata = await lstat(root.path);
    if (metadata.isSymbolicLink()) {
      await rm(root.path, { force: true });
      inventoryInvalid('validated source root was replaced by a symbolic link');
    }
    if (
      !root.identity ||
      !metadata.isDirectory() ||
      metadata.dev !== root.identity.device ||
      metadata.ino !== root.identity.inode ||
      (await realpath(root.path)) !== resolve(root.path)
    ) {
      inventoryInvalid('validated source root identity changed before purge');
    }
    await rm(root.path, { recursive: true, force: true });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
}

async function assertRegularArtifactPath(path: string): Promise<void> {
  try {
    const metadata = await lstat(path);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isFile() ||
      (await realpath(path)) !== resolve(path)
    ) {
      attestationInvalid(`artifact is not a regular file: ${path}`);
    }
  } catch (error) {
    if (error instanceof ScreenshotPrivacyError) throw error;
    attestationInvalid(`artifact is unavailable: ${path}`);
  }
}

async function artifactBytes(
  artifact: ScreenshotArtifactLike,
  baseDirectory: string | undefined,
  maximumBytes: number,
): Promise<Buffer> {
  if (!/^[0-9a-f]{64}$/u.test(artifact.sha256))
    attestationInvalid(`artifact hash is malformed: ${artifact.path}`);
  const bytes = await boundedFileBytes(
    artifactPath(artifact.path, baseDirectory),
    maximumBytes,
    attestationInvalid,
  );
  if (sha256(bytes) !== artifact.sha256)
    attestationInvalid(`artifact hash is mismatched: ${artifact.path}`);
  return bytes;
}

async function boundedFileBytes(
  path: string,
  maximumBytes: number,
  onFailure: (message: string) => never,
): Promise<Buffer> {
  return readBoundedRegularFile(path, {
    minimumBytes: 1,
    maximumBytes,
    onFailure,
  });
}

function artifactPath(path: string, baseDirectory?: string): string {
  if (isAbsolute(path)) return path;
  if (!baseDirectory) attestationInvalid(`relative artifact path lacks a base directory: ${path}`);
  return safeResolve(baseDirectory, path);
}

function bindingEntry(input: unknown, subject: string): { path: string; sha256: string } {
  const value = record(input, subject);
  exactKeys(value, ['path', 'sha256'], subject);
  return {
    path: safeRelativePath(string(value.path, `${subject}.path`, 1, 300), subject),
    sha256: digest(value.sha256, `${subject}.sha256`),
  };
}

function record(input: unknown, subject: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    attestationInvalid(`${subject} must be an object`);
  return input as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: string[], subject: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (!sameStrings(actual, wanted))
    attestationInvalid(`${subject} has unexpected or missing fields`);
}

function string(input: unknown, subject: string, minimum: number, maximum: number): string {
  if (
    typeof input !== 'string' ||
    input.length < minimum ||
    input.length > maximum ||
    hasControlCharacters(input)
  ) {
    attestationInvalid(`${subject} is not a bounded printable string`);
  }
  return input;
}

function hasControlCharacters(input: string): boolean {
  return [...input].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

function digest(input: unknown, subject: string): string {
  if (typeof input !== 'string' || !/^[0-9a-f]{64}$/u.test(input))
    attestationInvalid(`${subject} is not SHA-256`);
  return input;
}

function positiveInteger(input: unknown, subject: string, maximum: number): number {
  if (!Number.isSafeInteger(input) || (input as number) < 1 || (input as number) > maximum) {
    attestationInvalid(`${subject} is outside its bound`);
  }
  return input as number;
}

function validateTimestamp(value: string, subject: string): void {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    attestationInvalid(`${subject} is not a canonical timestamp`);
  }
}

function safeRelativePath(path: string, subject: string): string {
  if (
    typeof path !== 'string' ||
    path.length < 1 ||
    path.length > 300 ||
    path.includes('\\') ||
    path.startsWith('/') ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    inventoryInvalid(`${subject} path is unsafe: ${String(path)}`);
  }
  return path;
}

function safeResolve(baseDirectory: string, path: string): string {
  const base = resolve(baseDirectory);
  const candidate = resolve(base, path);
  if (candidate !== base && !candidate.startsWith(`${base}${sep}`))
    inventoryInvalid(`path escapes base directory: ${path}`);
  return candidate;
}

function pathsOverlap(left: string, right: string): boolean {
  const resolvedLeft = resolve(left);
  const resolvedRight = resolve(right);
  return (
    resolvedLeft === resolvedRight ||
    resolvedLeft.startsWith(`${resolvedRight}${sep}`) ||
    resolvedRight.startsWith(`${resolvedLeft}${sep}`)
  );
}

function normalizedRelative(base: string, path: string): string {
  return relative(resolve(base), path).split(sep).join('/');
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalize(value))}\n`;
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) attestationInvalid('provenance contains a non-finite number');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compare(left, right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  attestationInvalid(`provenance contains unsupported ${typeof value}`);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  }
  return value;
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function inventoryInvalid(message: string): never {
  throw new ScreenshotPrivacyError('ARXIC-SCREENSHOT-INVENTORY-INVALID', message);
}

function cleanupInvalid(primaryFailureCode: string | undefined): never {
  const error = new ScreenshotPrivacyError(
    'ARXIC-SCREENSHOT-INVENTORY-INVALID',
    'raw screenshot artifact cleanup could not be completed',
  );
  if (primaryFailureCode) {
    Object.defineProperty(error, 'cause', {
      configurable: false,
      enumerable: false,
      writable: false,
      value: Object.freeze({ code: primaryFailureCode }),
    });
  }
  throw error;
}

function attestationInvalid(message: string): never {
  throw new ScreenshotPrivacyError('ARXIC-SCREENSHOT-ATTESTATION-INVALID', message);
}
