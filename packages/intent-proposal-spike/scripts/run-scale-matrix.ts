/**
 * DG-04 evidence runner: executes the scale matrix against a real target
 * repository through the real ModelAdapter + a real OpenAI-compatible
 * endpoint. Credentials come ONLY from the environment and are never printed
 * or written (artifacts pass sanitizeArtifactJson first).
 *
 * Required env:
 *   ARXIC_DG04_SCALE_TARGET   absolute path of the cloned target repo
 *   ARXIC_DG04_REAL_BASE_URL  e.g. an OpenAI-compatible /v1 base URL
 *   ARXIC_DG04_REAL_KEY       API key (secret; never committed)
 *   ARXIC_DG04_REAL_MODEL     model id on that endpoint
 *   ARXIC_DG04_RECORD         output directory for sanitized artifacts
 * Optional env:
 *   ARXIC_DG04_MAX_ROWS_PER_CALL   (default 40)
 *   ARXIC_DG04_ONE_SHOT_ROW_CAP    (default 400)
 *   ARXIC_DG04_PRICE_PROMPT / ARXIC_DG04_PRICE_COMPLETION  USD per million tokens
 */
import { runScaleMatrix } from '../src/scale-run';

const target = process.env.ARXIC_DG04_SCALE_TARGET ?? '';
const recordDir = process.env.ARXIC_DG04_RECORD ?? '';
const envNumber = (name: string): number | undefined => {
  const raw = process.env[name];
  return raw !== undefined && raw !== '' ? Number(raw) : undefined;
};

const outcome = await runScaleMatrix({
  targetRepository: target,
  baseUrl: process.env.ARXIC_DG04_REAL_BASE_URL ?? '',
  key: process.env.ARXIC_DG04_REAL_KEY ?? '',
  model: process.env.ARXIC_DG04_REAL_MODEL ?? '',
  recordDir,
  maxRowsPerCall: envNumber('ARXIC_DG04_MAX_ROWS_PER_CALL'),
  oneShotRowCap: envNumber('ARXIC_DG04_ONE_SHOT_ROW_CAP'),
  pricePerMillionPrompt: envNumber('ARXIC_DG04_PRICE_PROMPT'),
  pricePerMillionCompletion: envNumber('ARXIC_DG04_PRICE_COMPLETION'),
});

if (outcome.ok) {
  const record = outcome.record as { runs?: unknown[]; target?: { rows?: number } };
  console.log(JSON.stringify({ ok: true, rows: record.target?.rows, runs: record.runs }, null, 1));
} else {
  console.log(
    JSON.stringify({ ok: false, diagnostics: outcome.diagnostics.map((d) => d.code) }, null, 1),
  );
  process.exitCode = 1;
}
