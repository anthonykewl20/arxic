import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256 } from '@arxic/contracts';
import { nativeScores, validateModel } from './model';
import {
  activateModel,
  activeModel,
  rollbackModel,
  stageArtifact,
  type ModelPointer,
} from './activation';

export { activeModel, rollbackModel };
export type { ModelPointer };

/**
 * End-to-end model activation over real trained artifacts (spec §14): verifies
 * the manifest→dataset→artifact hash bindings, gates activation on an
 * independent parity fixture (the native kernel against the trainer's exported
 * Python scores for the first dataset rows — never recomputed by this path),
 * then stages content-addressed bytes and flips the atomic pointer. The model
 * kind comes from the artifact header itself, not caller claims.
 */
export async function activateTrainedModel(
  output: string,
  modelPath: string,
  modelsDir: string,
  nativeBinary: string,
  options: { reportPath?: string } = {},
): Promise<ModelPointer> {
  const manifest = validateModel(JSON.parse((await readFile(join(output, modelPath))).toString()));
  const datasetBytes = await readFile(join(output, 'dataset.json'));
  if (sha256(datasetBytes) !== manifest.datasetSha256) throw new Error('dataset-binding-mismatch');
  const artifactBytes = await readFile(join(output, manifest.artifact.path));
  if (sha256(artifactBytes) !== manifest.artifact.sha256) throw new Error('artifact-hash-mismatch');
  const kind = artifactBytes.readUInt32LE(8) === 1 ? 'mlp' : 'logistic';
  const report = JSON.parse(
    await readFile(join(output, options.reportPath ?? 'training/training-report.json'), 'utf8'),
  );
  const rows: { id: string; features: number[] }[] = JSON.parse(datasetBytes.toString());
  const gate = {
    validate: async (bytes: Buffer) => {
      if (sha256(bytes) !== manifest.artifact.sha256) throw new Error('artifact-hash-mismatch');
      const fixture = rows.slice(0, 8);
      if (fixture.length < 1) throw new Error('parity-fixture-empty');
      const expected = fixture.map((row) => report.models[kind].scores[row.id]);
      if (expected.some((row) => !Array.isArray(row) || row.length !== 6))
        throw new Error('parity-fixture-missing');
      const scores = await nativeScores(
        nativeBinary,
        bytes,
        fixture.map((row) => row.features),
      );
      let maxError = 0;
      scores.forEach((row, i) =>
        row.forEach((value, j) => {
          maxError = Math.max(maxError, Math.abs(value - expected[i]![j]!));
        }),
      );
      if (maxError > 1e-5) throw new Error('parity-fixture-failed');
    },
  };
  const digest = await stageArtifact(modelsDir, artifactBytes);
  return activateModel(modelsDir, digest, gate);
}
