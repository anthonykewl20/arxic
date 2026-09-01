import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ARXIC_PROMOTION_REDACTION_FAILED,
  redactAndScanPersistedPayload,
} from '@arxic/bundle-promoter';
import { canonicalJson as serializeCanonicalJson, sha256 } from '@arxic/contracts';
import type {
  ImmutableArtifactRef,
  RunState,
  StageArtifact,
  StageCheckpoint,
  StageId,
} from './types';

export interface StageCheckpointer {
  load(runId: string): Promise<RunState | undefined>;
  saveArtifact(runId: string, stage: StageId, value: StageArtifact): Promise<ImmutableArtifactRef>;
  readArtifact(runId: string, ref: ImmutableArtifactRef): Promise<StageArtifact>;
  verifyArtifact(runId: string, ref: ImmutableArtifactRef): Promise<boolean>;
  saveCheckpoint(runId: string, checkpoint: StageCheckpoint, state: RunState): Promise<void>;
  /** Atomically replaces persisted run state without adding a stage checkpoint. */
  saveRunState?(runId: string, state: RunState): Promise<void>;
}

export class InMemoryStageCheckpointer implements StageCheckpointer {
  readonly #states = new Map<string, RunState>();
  readonly #artifacts = new Map<string, string>();

  async load(runId: string): Promise<RunState | undefined> {
    assertRunId(runId);
    return clone(this.#states.get(runId));
  }

  async saveArtifact(
    runId: string,
    stage: StageId,
    value: StageArtifact,
  ): Promise<ImmutableArtifactRef> {
    assertRunId(runId);
    const bytes = serializeStageArtifact(value);
    const ref = { id: `stage:${stage}`, sha256: sha256(bytes) } as const;
    this.#artifacts.set(`${runId}/${ref.id}`, bytes);
    return ref;
  }

  async readArtifact(runId: string, ref: ImmutableArtifactRef): Promise<StageArtifact> {
    assertRunId(runId);
    assertArtifactId(ref.id);
    const bytes = this.#artifacts.get(`${runId}/${ref.id}`);
    if (bytes === undefined) throw new Error(`Artifact ${ref.id} is missing`);
    return JSON.parse(bytes) as StageArtifact;
  }

  async verifyArtifact(runId: string, ref: ImmutableArtifactRef): Promise<boolean> {
    assertRunId(runId);
    assertArtifactId(ref.id);
    const bytes = this.#artifacts.get(`${runId}/${ref.id}`);
    return bytes !== undefined && sha256(bytes) === ref.sha256;
  }

  async saveCheckpoint(
    runId: string,
    _checkpoint: StageCheckpoint,
    state: RunState,
  ): Promise<void> {
    assertRunId(runId);
    this.#states.set(runId, clone(state));
  }

  async saveRunState(runId: string, state: RunState): Promise<void> {
    assertRunId(runId);
    this.#states.set(runId, clone(state));
  }
}

export class FileStageCheckpointer implements StageCheckpointer {
  readonly #runsDirectory: string;
  readonly #redactionValues: readonly string[];

  constructor(
    runsDirectory: string,
    options: Readonly<{ redactionValues?: readonly string[] }> = {},
  ) {
    this.#runsDirectory = runsDirectory;
    this.#redactionValues = options.redactionValues ?? [];
  }

  async load(runId: string): Promise<RunState | undefined> {
    assertRunId(runId);
    const stagesDirectory = join(this.#runsDirectory, runId, 'stages');
    let names: string[];
    try {
      names = (await readdir(stagesDirectory)).filter((name) => /^\d{2}\.json$/u.test(name)).sort();
    } catch {
      return undefined;
    }
    if (names.length === 0) return undefined;
    // Stage 13 (domain-inventory) EXECUTES between stages 2 and 3, so its
    // file `13.json` sorts LAST while holding an EARLIER state than
    // `03.json`–`12.json`. The most-advanced persisted state is therefore
    // NOT always the lexicographically-last file: every checkpoint persists
    // the full state, so select the state with the most completed stages
    // (ties broken by checkpoint count, which grows monotonically).
    let best: RunState | undefined;
    for (const name of names) {
      const record = JSON.parse(await readFile(join(stagesDirectory, name), 'utf8')) as {
        state: RunState;
      };
      const state = record.state;
      if (
        best === undefined ||
        state.completedStages.length > best.completedStages.length ||
        (state.completedStages.length === best.completedStages.length &&
          state.checkpoints.length > best.checkpoints.length)
      ) {
        best = state;
      }
    }
    return best;
  }

  async saveArtifact(
    runId: string,
    stage: StageId,
    value: StageArtifact,
  ): Promise<ImmutableArtifactRef> {
    assertRunId(runId);
    const directory = join(this.#runsDirectory, runId, 'artifacts');
    await mkdir(directory, { recursive: true });
    const bytes = this.#preparePersistedBytes(
      `${serializeStageArtifact(value)}\n`,
      !isSourceBearingStage(stage),
    );
    const ref = { id: `stage:${stage}`, sha256: sha256(bytes) } as const;
    await atomicWrite(join(directory, `${pad(stage)}.json`), bytes);
    return ref;
  }

  async readArtifact(runId: string, ref: ImmutableArtifactRef): Promise<StageArtifact> {
    assertRunId(runId);
    assertArtifactId(ref.id);
    const stage = Number(ref.id.slice('stage:'.length));
    return JSON.parse(
      await readFile(join(this.#runsDirectory, runId, 'artifacts', `${pad(stage)}.json`), 'utf8'),
    ) as StageArtifact;
  }

  async verifyArtifact(runId: string, ref: ImmutableArtifactRef): Promise<boolean> {
    assertRunId(runId);
    assertArtifactId(ref.id);
    try {
      const bytes = await readFile(
        join(
          this.#runsDirectory,
          runId,
          'artifacts',
          `${pad(Number(ref.id.slice('stage:'.length)))}.json`,
        ),
      );
      return sha256(bytes.toString('utf8')) === ref.sha256;
    } catch {
      return false;
    }
  }

  async saveCheckpoint(runId: string, checkpoint: StageCheckpoint, state: RunState): Promise<void> {
    assertRunId(runId);
    const directory = join(this.#runsDirectory, runId, 'stages');
    await mkdir(directory, { recursive: true });
    await atomicWrite(
      join(directory, `${pad(checkpoint.stage)}.json`),
      this.#preparePersistedBytes(`${serializeStageArtifact({ checkpoint, state })}\n`, true),
    );
  }

  async saveRunState(runId: string, state: RunState): Promise<void> {
    assertRunId(runId);
    const checkpoint = state.checkpoints.at(-1);
    if (!checkpoint) throw new Error('Cannot persist run state without a checkpoint');
    const directory = join(this.#runsDirectory, runId, 'stages');
    await mkdir(directory, { recursive: true });
    await atomicWrite(
      join(directory, `${pad(checkpoint.stage)}.json`),
      this.#preparePersistedBytes(`${serializeStageArtifact({ checkpoint, state })}\n`, true),
    );
  }

  #preparePersistedBytes(bytes: string, includePatternClasses: boolean): string {
    const { text, diagnostics } = redactAndScanPersistedPayload(bytes, {
      knownValues: this.#redactionValues,
      includePatternClasses,
    });
    if (diagnostics.length > 0)
      throw new PersistedSecretError(diagnostics.map(({ subject }) => subject));
    return text;
  }
}

/**
 * Stages 1–3 and 13 persist source-derived records that can include target
 * source snippets. They remain exact-value scanned, but class regexes would
 * mistake the target's own password-looking code for retained credentials.
 */
function isSourceBearingStage(stage: StageId): boolean {
  return stage === 1 || stage === 2 || stage === 3 || stage === 13;
}

/** Fail-closed write-time redaction sweep using the established promotion code. */
export class PersistedSecretError extends Error {
  readonly code = ARXIC_PROMOTION_REDACTION_FAILED;
  readonly patterns: readonly string[];

  constructor(patterns: readonly string[]) {
    super(`Refusing to persist sensitive data matched ${patterns.join(', ')}`);
    this.name = 'PersistedSecretError';
    this.patterns = patterns;
  }
}

/** Legacy artifact bytes are a persisted compatibility surface. */
const serializeStageArtifact = (value: unknown): string =>
  serializeCanonicalJson(value, { mode: 'legacy' });

export { serializeStageArtifact as canonicalJson };

export function artifactHash(value: StageArtifact, fileBacked = false): string {
  const bytes = `${serializeStageArtifact(value)}${fileBacked ? '\n' : ''}`;
  return sha256(bytes);
}

function pad(stage: number): string {
  return String(stage).padStart(2, '0');
}

async function atomicWrite(path: string, bytes: string): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes, { mode: 0o600 });
  await rename(temporary, path);
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function assertRunId(runId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(runId)) {
    throw new Error('Run id must be a safe opaque identifier');
  }
}

function assertArtifactId(id: string): void {
  // Stage 13 (domain-inventory, DG-06) is the next available id after 0–12.
  if (!/^stage:(?:[0-9]|1[0-3])$/u.test(id)) throw new Error('Artifact id is invalid');
}
