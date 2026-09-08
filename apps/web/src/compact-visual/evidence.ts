import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import Ajv from 'ajv';
import { sha256 } from '@arxic/contracts';
import { inspectPng } from '@arxic/playwright-screenshot-privacy';

export const HEADS = [
  'clipping',
  'occlusion',
  'missing_element',
  'overflow',
  'text_truncation',
  'layout_shift',
] as const;
export type Box = { x: number; y: number; width: number; height: number };
export type Measurement = {
  box: Box | null;
  clip: number | null;
  hit: number | null;
  overflowX: number | null;
  overflowY: number | null;
};
export type Ref = { path: string; sha256: string };
export type VisualCase = {
  version: 1;
  id: string;
  group: string;
  revision: string;
  consent: true;
  context: { width: number; height: number; dpr: number; profile: string; state: string };
  before: Ref;
  current: Ref;
  beforePrivacy: Ref;
  currentPrivacy: Ref;
  scene: Ref;
  timeline: Ref;
  timelineProvenance: Ref;
};
export type Scene = {
  version: 1;
  beforeSha256: string;
  currentSha256: string;
  sanitized: true;
  stable: true;
  regions: {
    id: string;
    box: Box;
    before: Measurement;
    current: Measurement;
    eligible: boolean[];
    criterion: string;
  }[];
  hardChecks: {
    id: string;
    head: string;
    verdict: 'pass' | 'fail' | 'unverified';
    region: string;
  }[];
};
const object = (properties: Record<string, object>, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const id = { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,80}$' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const ref = object({ path: { type: 'string', minLength: 1, maxLength: 240 }, sha256: hash });
const numeric = { type: 'number', minimum: -1000000, maximum: 1000000 };
const box = object({
  x: numeric,
  y: numeric,
  width: { type: 'number', minimum: 0, maximum: 1000000 },
  height: { type: 'number', minimum: 0, maximum: 1000000 },
});
const fraction = { anyOf: [{ type: 'number', minimum: 0, maximum: 1 }, { type: 'null' }] };
const overflow = { anyOf: [{ type: 'number', minimum: 0, maximum: 1000000 }, { type: 'null' }] };
const measurement = object({
  box: { anyOf: [box, { type: 'null' }] },
  clip: fraction,
  hit: fraction,
  overflowX: overflow,
  overflowY: overflow,
});
const ajv = new Ajv({ strict: true, allErrors: false });
const caseValidator = ajv.compile(
  object({
    version: { const: 1, type: 'integer' },
    id,
    group: id,
    revision: { type: 'string', pattern: '^([a-f0-9]{40}|[a-f0-9]{64})$' },
    consent: { const: true, type: 'boolean' },
    context: object({
      width: { type: 'integer', minimum: 1, maximum: 2048 },
      height: { type: 'integer', minimum: 1, maximum: 2048 },
      dpr: { type: 'number', minimum: 0.5, maximum: 3 },
      profile: id,
      state: id,
    }),
    before: ref,
    current: ref,
    beforePrivacy: ref,
    currentPrivacy: ref,
    scene: ref,
    timeline: ref,
    timelineProvenance: ref,
  }),
);
const sceneValidator = ajv.compile(
  object({
    version: { const: 1, type: 'integer' },
    beforeSha256: hash,
    currentSha256: hash,
    sanitized: { const: true, type: 'boolean' },
    stable: { const: true, type: 'boolean' },
    regions: {
      type: 'array',
      maxItems: 128,
      items: object({
        id,
        box,
        before: measurement,
        current: measurement,
        eligible: { type: 'array', minItems: 6, maxItems: 6, items: { type: 'boolean' } },
        criterion: id,
      }),
    },
    hardChecks: {
      type: 'array',
      maxItems: 768,
      items: object({
        id,
        head: { type: 'string', enum: HEADS },
        verdict: { type: 'string', enum: ['pass', 'fail', 'unverified'] },
        region: id,
      }),
    },
  }),
);
const privacyValidator = ajv.compile(
  object({
    version: { const: 1, type: 'integer' },
    screenshotSha256: hash,
    mode: { const: 'input-masked', type: 'string' },
    masks: { type: 'array', maxItems: 256, items: box },
    rawTraceRetained: { const: false, type: 'boolean' },
  }),
);
const timelineValidator = ajv.compile(
  object({
    version: { const: 1, type: 'integer' },
    actions: {
      type: 'array',
      maxItems: 64,
      items: {
        type: 'string',
        enum: [
          'capture-before',
          'apply-controlled-regression',
          'capture-current',
          'measure',
          'assert-pass',
        ],
      },
    },
  }),
);
const provenanceValidator = ajv.compile(
  object({
    version: { const: 1, type: 'integer' },
    sha256: hash,
    method: { const: 'allowlisted-actions-v1', type: 'string' },
    rawTraceRetained: { const: false, type: 'boolean' },
  }),
);

export function validateCase(input: unknown): VisualCase {
  if (!caseValidator(input)) throw new Error('invalid-case');
  return input as VisualCase;
}

export async function boundedRead(root: string, path: string, limit: number): Promise<Buffer> {
  if (isAbsolute(path) || path.split(/[\\/]/u).some((part) => part === '..' || part === ''))
    throw new Error('unsafe-path');
  const base = await realpath(root);
  const target = resolve(base, path);
  const actual = await realpath(target);
  if (actual !== target || relative(base, actual).startsWith('..')) throw new Error('unsafe-path');
  const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error('file-bound');
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < buffer.length) {
      const result = await file.read(buffer, size, buffer.length - size, null);
      if (result.bytesRead === 0) break;
      size += result.bytesRead;
    }
    if (size > limit) throw new Error('file-bound');
    return Buffer.from(buffer.subarray(0, size));
  } finally {
    await file.close();
  }
}

export function inside(box: Box, width: number, height: number): boolean {
  return box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height;
}

export async function loadVisualCase(root: string, path: string) {
  const manifestBytes = await boundedRead(root, path, 1024 * 1024);
  const manifest = validateCase(JSON.parse(manifestBytes.toString()));
  const read = async (reference: Ref, limit = 1024 * 1024) => {
    const bytes = await boundedRead(root, reference.path, limit);
    if (sha256(bytes) !== reference.sha256) throw new Error('evidence-hash-mismatch');
    return bytes;
  };
  const before = await read(manifest.before, 4 * 1024 * 1024);
  const current = await read(manifest.current, 4 * 1024 * 1024);
  const { width, height, dpr } = manifest.context;
  for (const bytes of [before, current]) {
    // Bound IHDR before the canonical inspector inflates any pixel data.
    if (bytes.length < 24) throw new Error('image-bound');
    const w = bytes.readUInt32BE(16),
      h = bytes.readUInt32BE(20);
    if (
      w > 2048 ||
      h > 2048 ||
      w * h > 2097152 ||
      w !== Math.round(width * dpr) ||
      h !== Math.round(height * dpr)
    )
      throw new Error('image-bound');
    inspectPng(bytes);
  }
  const masks: Box[][] = [];
  for (const [reference, png] of [
    [manifest.beforePrivacy, manifest.before],
    [manifest.currentPrivacy, manifest.current],
  ] as const) {
    const privacy = JSON.parse((await read(reference)).toString());
    if (!privacyValidator(privacy) || privacy.screenshotSha256 !== png.sha256)
      throw new Error('invalid-privacy');
    const rectangles = privacy.masks as Box[];
    if (rectangles.some((b) => !inside(b, Math.round(width * dpr), Math.round(height * dpr))))
      throw new Error('invalid-privacy');
    masks.push(rectangles);
  }
  if (JSON.stringify(masks[0]) !== JSON.stringify(masks[1])) throw new Error('incompatible-masks');
  const scene = JSON.parse((await read(manifest.scene)).toString()) as Scene;
  if (
    !sceneValidator(scene) ||
    scene.beforeSha256 !== manifest.before.sha256 ||
    scene.currentSha256 !== manifest.current.sha256
  )
    throw new Error('invalid-scene');
  const ids = new Set(scene.regions.map((r) => r.id));
  if (
    ids.size !== scene.regions.length ||
    scene.regions.some(
      (r) =>
        !inside(r.box, Math.round(width * dpr), Math.round(height * dpr)) ||
        r.box.width < 1 ||
        r.box.height < 1,
    ) ||
    scene.hardChecks.some((c) => !ids.has(c.region))
  )
    throw new Error('invalid-region');
  const timeline = await read(manifest.timeline);
  const provenance = JSON.parse((await read(manifest.timelineProvenance)).toString());
  if (
    !timelineValidator(JSON.parse(timeline.toString())) ||
    !provenanceValidator(provenance) ||
    provenance.sha256 !== manifest.timeline.sha256
  )
    throw new Error('invalid-timeline');
  return {
    manifest,
    manifestSha256: sha256(manifestBytes),
    before,
    current,
    scene,
    masks: masks[0]!,
  };
}
