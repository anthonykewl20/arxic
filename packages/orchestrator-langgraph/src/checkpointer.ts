import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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
    const bytes = canonicalJson(value);
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
}

export class FileStageCheckpointer implements StageCheckpointer {
  readonly #runsDirectory: string;

  constructor(runsDirectory: string) {
    this.#runsDirectory = runsDirectory;
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
    const record = JSON.parse(
      await readFile(join(stagesDirectory, names[names.length - 1]), 'utf8'),
    ) as { state: RunState };
    return record.state;
  }

  async saveArtifact(
    runId: string,
    stage: StageId,
    value: StageArtifact,
  ): Promise<ImmutableArtifactRef> {
    assertRunId(runId);
    const directory = join(this.#runsDirectory, runId, 'artifacts');
    await mkdir(directory, { recursive: true });
    const bytes = `${canonicalJson(value)}\n`;
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
      `${canonicalJson({ checkpoint, state })}\n`,
    );
  }
}

export function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(sortValue(value));
  if (serialized === undefined) throw new Error('Artifact is not JSON serializable');
  return serialized;
}

export function artifactHash(value: StageArtifact, fileBacked = false): string {
  const bytes = `${canonicalJson(value)}${fileBacked ? '\n' : ''}`;
  return sha256(bytes);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function pad(stage: number): string {
  return String(stage).padStart(2, '0');
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  return value;
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
  if (!/^stage:(?:[0-9]|1[0-2])$/u.test(id)) throw new Error('Artifact id is invalid');
}
