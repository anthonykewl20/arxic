/**
 * Evaluate-only corpus scoring (refs #553; register gate C4).
 *
 * Scores corpus cases against the ALREADY trained compact-visual artifact. By
 * design this module never invokes the Python trainer, the rust compile, or
 * any write the trainer owns (dataset.json, provenance, model manifests,
 * promotion pointer): a chronological holdout is only meaningful if the scored
 * artifact is provably the one training produced, so every score binds to the
 * trained bins by sha256 and the training directory is treated as read-only.
 */
import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256 } from '@arxic/contracts';
import { nativeScores, validateModel, type ModelManifest } from './model';
import { buildLabeledRows, captureCorpusV2, type CorpusV2Manifest } from './corpus-capture';
import { DEFECT_HEADS } from './corpus';

const REQUIRED_ARTIFACTS = [
  'training/logistic.bin',
  'training/mlp.bin',
  'training/training-report.json',
  'logistic-model.json',
  'mlp-model.json',
  'visual-native',
] as const;

async function readTrainedArtifacts(output: string) {
  for (const artifact of REQUIRED_ARTIFACTS)
    await access(join(output, artifact)).catch(() => {
      throw new Error(`no-trained-artifact (${artifact} missing)`);
    });
  const [logisticBin, mlpBin, logisticModel, mlpModel] = await Promise.all([
    readFile(join(output, 'training/logistic.bin')),
    readFile(join(output, 'training/mlp.bin')),
    readFile(join(output, 'logistic-model.json'), 'utf8'),
    readFile(join(output, 'mlp-model.json'), 'utf8'),
  ]);
  return {
    native: join(output, 'visual-native'),
    bins: { logistic: logisticBin, mlp: mlpBin },
    models: {
      logistic: validateModel(JSON.parse(logisticModel)) as ModelManifest,
      mlp: validateModel(JSON.parse(mlpModel)) as ModelManifest,
    },
  };
}

export async function evaluateCorpusV2(
  root: string,
  output: string,
  options: {
    reuseManifest?: string;
    families?: string[];
    viewports?: number[];
    variants?: string[];
  } = {},
) {
  // Sad path first: refuse before any capture or report write.
  const trained = await readTrainedArtifacts(output);
  let corpus: CorpusV2Manifest;
  let corpusManifestPath: string;
  if (options.reuseManifest) {
    corpusManifestPath = join(output, options.reuseManifest);
    corpus = JSON.parse(await readFile(corpusManifestPath, 'utf8')) as CorpusV2Manifest;
  } else {
    corpus = await captureCorpusV2(
      root,
      output,
      options.families ?? ['next', 'express', 'arxic', 'koel', 'directus'],
      options.viewports ?? [360, 640, 1024, 1280],
      options.variants?.length ? options.variants : undefined,
    );
    corpusManifestPath = join(output, 'corpus-v2.json');
  }
  const corpusManifestSha256 = sha256(await readFile(corpusManifestPath));
  const { rows } = await buildLabeledRows(output, corpus);

  // The reviewer's decision model is the mlp manifest (reviewCase's basis);
  // logistic is bound as evidence of which artifact generation was scored.
  const model = trained.models.mlp;
  const scoreable = (index: number) =>
    model.supported[index] === true && model.thresholds[index] !== null;
  const scores: number[][] = [];
  for (let start = 0; start < rows.length; start += 128) {
    scores.push(
      ...(
        await nativeScores(
          trained.native,
          trained.bins.mlp,
          rows.slice(start, start + 128).map((row) => row.features),
        )
      ),
    );
  }
  const heads = DEFECT_HEADS.map((head, index) => ({
    head,
    scoreable: scoreable(index),
    cases: 0,
    truePositives: 0,
    falsePositives: 0,
    trueNegatives: 0,
    falseNegatives: 0,
  }));
  for (const [i, row] of rows.entries()) {
    for (const [head, actual] of row.labels.entries()) {
      if (actual === null || !scoreable(head)) continue;
      const predicted = scores[i]![head]! >= model.thresholds[head]! ? 1 : 0;
      const tally = heads[head]!;
      tally.cases += 1;
      if (actual === 1) predicted === 1 ? (tally.truePositives += 1) : (tally.falseNegatives += 1);
      else predicted === 1 ? (tally.falsePositives += 1) : (tally.trueNegatives += 1);
    }
  }
  const report = {
    version: 1,
    basis: 'mlp-model.json',
    rows: rows.length,
    models: {
      logisticSha256: sha256(trained.bins.logistic),
      mlpSha256: sha256(trained.bins.mlp),
      datasetSha256: model.datasetSha256,
    },
    corpusManifestSha256,
    heads: heads.map((tally) => ({
      ...tally,
      accuracy:
        tally.cases === 0 ? null : (tally.truePositives + tally.trueNegatives) / tally.cases,
    })),
  };
  await writeFile(
    join(output, 'corpus-evaluation.json'),
    Buffer.from(JSON.stringify(report, null, 2) + '\n'),
    { mode: 0o600 },
  );
  return report;
}
