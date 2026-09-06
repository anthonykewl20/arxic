import { execFile } from 'node:child_process';
import Ajv from 'ajv';
import { sha256 } from '@arxic/contracts';
import { boundedRead, HEADS, type Scene } from './evidence';
import { extractCase } from './features';

export type ModelManifest = {
  version: 1;
  featureSchema: 'arxic-visual-features-v1';
  artifact: { path: string; sha256: string };
  thresholds: (number | null)[];
  supported: boolean[];
  experimental: true;
  datasetSha256: string;
};
const validate = new Ajv({ strict: true }).compile({
  type: 'object',
  additionalProperties: false,
  required: [
    'version',
    'featureSchema',
    'artifact',
    'thresholds',
    'supported',
    'experimental',
    'datasetSha256',
  ],
  properties: {
    version: { type: 'integer', const: 1 },
    featureSchema: { type: 'string', const: 'arxic-visual-features-v1' },
    experimental: { type: 'boolean', const: true },
    datasetSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    artifact: {
      type: 'object',
      additionalProperties: false,
      required: ['path', 'sha256'],
      properties: {
        path: { type: 'string', minLength: 1, maxLength: 240 },
        sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      },
    },
    thresholds: {
      type: 'array',
      minItems: 6,
      maxItems: 6,
      items: { anyOf: [{ type: 'number', minimum: 0, maximum: 1 }, { type: 'null' }] },
    },
    supported: { type: 'array', minItems: 6, maxItems: 6, items: { type: 'boolean' } },
  },
});
export function validateModel(input: unknown): ModelManifest {
  if (!validate(input)) throw new Error('invalid-model');
  return input as ModelManifest;
}

export function nativeScores(
  binary: string,
  model: Buffer,
  features: number[][],
): Promise<number[][]> {
  if (
    !features.length ||
    features.length > 128 ||
    features.some((x) => x.length !== 96 || x.some((v) => !Number.isFinite(v)))
  )
    return Promise.reject(new Error('invalid-features'));
  const input = Buffer.alloc(features.length * 384);
  features.flat().forEach((v, index) => input.writeFloatLE(v, index * 4));
  return new Promise((resolve, reject) => {
    const child = execFile(
      binary,
      [],
      { encoding: 'buffer', timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 4096, env: {} },
      (error, stdout) => {
        if (error || stdout.length !== features.length * 24) {
          reject(new Error('native-inference-failed'));
          return;
        }
        const scores = features.map((_, row) =>
          HEADS.map((_, head) => stdout.readFloatLE(row * 24 + head * 4)),
        );
        if (scores.flat().some((v) => !Number.isFinite(v) || v < 0 || v > 1)) {
          reject(new Error('invalid-scores'));
          return;
        }
        resolve(scores);
      },
    );
    child.stdin?.on('error', () => {
      /* callback classifies an early child exit */
    });
    child.stdin?.end(Buffer.concat([model, input]));
  });
}

export function fuseShadow(hardChecks: Scene['hardChecks'], predictions: unknown[]) {
  return {
    hardChecks,
    predictions,
    modelAuthority: 'hypothesis-only',
    overallPass: false,
    promotion: 'blocked-experimental-model',
  };
}

export async function reviewCase(
  root: string,
  casePath: string,
  modelPath: string,
  binary: string,
) {
  const extracted = await extractCase(root, casePath);
  try {
    const model = validateModel(JSON.parse((await boundedRead(root, modelPath, 65536)).toString()));
    const artifact = await boundedRead(root, model.artifact.path, 35000);
    if (sha256(artifact) !== model.artifact.sha256) throw new Error('model-hash-mismatch');
    const scores = extracted.regions.length
      ? await nativeScores(
          binary,
          artifact,
          extracted.regions.map((r) => r.values),
        )
      : [];
    const predictions = extracted.regions.flatMap((region, row) =>
      HEADS.map((head, index) => {
        const threshold = model.thresholds[index];
        const eligible =
          region.usable && region.eligible[index] && model.supported[index] && threshold !== null;
        return {
          regionId: region.id,
          head,
          score: eligible ? scores[row]![index] : null,
          decision: eligible && scores[row]![index]! >= threshold! ? 'hypothesis' : 'abstain',
          reason: !region.usable
            ? 'masked-region'
            : !region.eligible[index]
              ? 'missing-applicability'
              : !model.supported[index]
                ? 'unsupported-training-head'
                : threshold === null
                  ? 'uncalibrated-head'
                  : 'experimental-score',
        };
      }),
    );
    return {
      caseId: extracted.caseId,
      manifestSha256: extracted.manifestSha256,
      modelSha256: model.artifact.sha256,
      modelStatus: 'observed',
      diagnostic: null as string | null,
      changedPixels: extracted.changedPixels,
      coverage: extracted.coverage,
      ...fuseShadow(extracted.hardChecks, predictions),
    };
  } catch (error) {
    const allowed = new Set([
      'invalid-model',
      'model-hash-mismatch',
      'native-inference-failed',
      'invalid-features',
      'invalid-scores',
      'unsafe-path',
      'file-bound',
    ]);
    const diagnostic =
      error instanceof Error && allowed.has(error.message)
        ? error.message
        : 'model-unavailable-or-invalid';
    return {
      caseId: extracted.caseId,
      manifestSha256: extracted.manifestSha256,
      modelSha256: null,
      modelStatus: 'blocked',
      diagnostic,
      changedPixels: extracted.changedPixels,
      coverage: extracted.coverage,
      ...fuseShadow(extracted.hardChecks, []),
    };
  }
}
