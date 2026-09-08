import { randomUUID } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { boundedRead, validateCase } from './evidence';
import { freeReserveOk } from './retention';

/**
 * Bounded analysis intake (spec §13): one active comparison, at most four
 * queued metadata-only jobs, fifth submission rejected with backpressure, a
 * per-job analysis deadline, and admission that validates the referenced case
 * manifest is a bounded safe path before a slot is consumed. Queue entries hold
 * validated file references, never in-memory image copies; full evidence
 * loading happens inside the caller's executor. An append-only JSONL journal
 * (when configured) makes a crash recoverable: interrupted jobs return to the
 * queue with their original ids, a torn final line is tolerated, mid-file
 * corruption is refused, and re-submitting a still-pending case is idempotent.
 * Service block: it never classifies truth states — deadline/execution
 * failures are recorded, the caller decides what they mean.
 */
export type IntakeJob = {
  id: string;
  casePath: string;
  state: 'queued' | 'active' | 'complete' | 'failed';
  diagnostic: string | null;
  submittedAt: number;
};
export type SubmitRejection =
  | 'backpressure'
  | 'invalid-case'
  | 'unsafe-path'
  | 'file-bound'
  | 'journal-write-failed'
  | 'disk-reserve-breach'
  | 'disk-reserve-unavailable';
export type SubmitResult =
  { accepted: true; id: string } | { accepted: false; reason: SubmitRejection; id: null };

const HISTORY_BOUND = 256;
const JOURNAL_BOUND = 8 * 1024 * 1024;
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type JournalEntry =
  | { type: 'admitted'; id: string; casePath: string; submittedAt: number }
  | { type: 'started'; id: string }
  | { type: 'terminal'; id: string; state: 'complete' | 'failed'; diagnostic: string | null };

export type JournalState = {
  history: IntakeJob[];
  interrupted: IntakeJob[];
  tornTailEntries: number;
};

/** Fold a JSONL intake journal. Torn final lines are crash artifacts; torn
 * interior lines are corruption and must fail closed. */
export function loadJournal(path: string): JournalState {
  // The journal path is operator-owned configuration, not submitted evidence;
  // there is no root to escape, so only the size bound applies.
  const bytes = readFileSync(resolve(path));
  if (bytes.length > JOURNAL_BOUND) throw new Error('file-bound');
  const lines = bytes.toString().split('\n');
  let tornTailEntries = 0;
  const entries: JournalEntry[] = [];
  const record = (value: { id?: unknown }) => typeof value.id === 'string';
  const shaped = (value: unknown): value is JournalEntry => {
    if (!value || typeof value !== 'object') return false;
    const entry = value as Partial<JournalEntry> & {
      id?: unknown;
      casePath?: unknown;
      submittedAt?: unknown;
      state?: unknown;
      diagnostic?: unknown;
    };
    if (entry.type === 'admitted')
      return (
        record(entry) && typeof entry.casePath === 'string' && typeof entry.submittedAt === 'number'
      );
    if (entry.type === 'started') return record(entry);
    if (entry.type === 'terminal')
      return (
        record(entry) &&
        (entry.state === 'complete' || entry.state === 'failed') &&
        (entry.diagnostic === null || typeof entry.diagnostic === 'string')
      );
    return false;
  };
  lines.forEach((line, index) => {
    if (!line) return; // trailing newline or blank line
    let entry: unknown = null;
    try {
      entry = JSON.parse(line);
    } catch {
      /* torn or corrupt */
    }
    if (!shaped(entry)) {
      // A crash can tear only the final line; anything earlier is corruption.
      if (index === lines.length - 1) {
        tornTailEntries += 1;
        return;
      }
      throw new Error('journal-corrupt');
    }
    entries.push(entry);
  });
  const jobs = new Map<string, IntakeJob>();
  const terminals = new Map<string, JournalEntry & { type: 'terminal' }>();
  for (const entry of entries) {
    if (entry.type === 'admitted')
      jobs.set(entry.id, {
        id: entry.id,
        casePath: entry.casePath,
        state: 'queued',
        diagnostic: null,
        submittedAt: entry.submittedAt,
      });
    else if (entry.type === 'terminal') terminals.set(entry.id, entry);
  }
  const history: IntakeJob[] = [];
  const interrupted: IntakeJob[] = [];
  for (const job of jobs.values()) {
    const terminal = terminals.get(job.id);
    if (terminal) history.push({ ...job, state: terminal.state, diagnostic: terminal.diagnostic });
    else interrupted.push(job);
  }
  interrupted.sort((a, b) => a.submittedAt - b.submittedAt);
  history.sort((a, b) => a.submittedAt - b.submittedAt);
  return { history, interrupted, tornTailEntries };
}

type StatfsLike = (path: string) => Promise<{ bsize: number; bavail: number }>;

export function createIntakeQueue(options: {
  root: string;
  execute: (job: IntakeJob) => Promise<unknown>;
  journalPath?: string;
  maxQueued?: number;
  deadlineMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Spec §13: refuse admission before the spool free reserve is breached. */
  freeReserve?: { path: string; minFreeBytes: number; statfs?: StatfsLike };
}) {
  const maxQueued = options.maxQueued ?? 4;
  const deadlineMs = options.deadlineMs ?? 10_000;
  const sleep = options.sleep ?? defaultSleep;
  const journal = options.journalPath ? resolve(options.journalPath) : null;
  let counter = 0;
  let active: IntakeJob | null = null;
  const queued: IntakeJob[] = [];
  const history: IntakeJob[] = [];
  const activeWaiters: (() => void)[] = [];
  const idleWaiters: (() => void)[] = [];

  const record = (entry: JournalEntry) =>
    journal ? appendFile(journal, JSON.stringify(entry) + '\n') : Promise.resolve();

  if (journal && existsSync(journal)) {
    const state = loadJournal(journal);
    for (const job of state.interrupted) queued.push({ ...job, state: 'queued' });
    for (const job of state.history) history.push(job);
    counter = [...queued, ...history].reduce(
      (max, job) => Math.max(max, Number(job.id.split('-').pop() ?? 0) || 0),
      0,
    );
    // Recovered jobs count against the queue bound; overflow is recorded as
    // failed (never silently dropped) so callers see the backpressure.
    while (queued.length > maxQueued) {
      const overflow = queued.pop()!;
      overflow.state = 'failed';
      overflow.diagnostic = 'recovery-queue-overflow';
      history.push(overflow);
    }
    // Resume draining immediately: recovery must not wait for a new submission.
    if (queued.length) pump();
  }

  const remember = (job: IntakeJob) => {
    history.push(job);
    if (history.length > HISTORY_BOUND) history.shift();
  };

  async function admit(casePath: string): Promise<void> {
    const bytes = await boundedRead(options.root, casePath, 1024 * 1024);
    try {
      validateCase(JSON.parse(bytes.toString()));
    } catch {
      throw new Error('invalid-case');
    }
  }

  function pump(): void {
    if (active) return;
    if (!queued.length) {
      idleWaiters.splice(0).forEach((resolve) => resolve());
      return;
    }
    active = queued.shift()!;
    active.state = 'active';
    activeWaiters.splice(0).forEach((resolve) => resolve());
    const job = active;
    void record({ type: 'started', id: job.id }).catch(() => {});
    void (async () => {
      try {
        await new Promise<unknown>((resolveExecution, rejectExecution) => {
          let settled = false;
          options.execute(job).then(
            (value) => {
              if (!settled) {
                settled = true;
                resolveExecution(value);
              }
            },
            (error) => {
              if (!settled) {
                settled = true;
                rejectExecution(error);
              }
            },
          );
          sleep(deadlineMs).then(
            () => {
              if (!settled) {
                settled = true;
                rejectExecution(new Error('deadline-exceeded'));
              }
            },
            () => {},
          );
        });
        job.state = 'complete';
        job.diagnostic = null;
      } catch (error) {
        job.state = 'failed';
        job.diagnostic =
          error instanceof Error && error.message === 'deadline-exceeded'
            ? 'deadline-exceeded'
            : 'execution-failed';
      } finally {
        await record({
          type: 'terminal',
          id: job.id,
          state: job.state === 'complete' ? 'complete' : 'failed',
          diagnostic: job.diagnostic,
        }).catch(() => {});
        remember(job);
        active = null;
        pump();
      }
    })();
  }

  return {
    async submit(request: { casePath: string }): Promise<SubmitResult> {
      // Idempotent while pending: the same case already admitted and not yet
      // terminal returns its original id instead of double-admitting.
      const pending = [active, ...queued].find((job) => job?.casePath === request.casePath);
      if (pending) return { accepted: true, id: pending.id };
      if (options.freeReserve) {
        const reserve = await freeReserveOk(
          options.freeReserve.path,
          options.freeReserve.minFreeBytes,
          options.freeReserve.statfs as Parameters<typeof freeReserveOk>[2],
        );
        if (!reserve.ok) return { accepted: false, reason: reserve.reason!, id: null };
      }
      if (queued.length >= maxQueued) return { accepted: false, reason: 'backpressure', id: null };
      try {
        await admit(request.casePath);
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message === 'unsafe-path' || message === 'file-bound' || message === 'invalid-case')
          return { accepted: false, reason: message, id: null };
        return { accepted: false, reason: 'invalid-case', id: null };
      }
      counter += 1;
      const id = `job-${randomUUID().slice(0, 8)}-${counter}`;
      const job: IntakeJob = {
        id,
        casePath: request.casePath,
        state: 'queued',
        diagnostic: null,
        submittedAt: Date.now(),
      };
      try {
        await record({
          type: 'admitted',
          id: job.id,
          casePath: job.casePath,
          submittedAt: job.submittedAt,
        });
      } catch {
        return { accepted: false, reason: 'journal-write-failed', id: null };
      }
      queued.push(job);
      pump();
      return { accepted: true, id };
    },
    waitForActive(): Promise<void> {
      if (active) return Promise.resolve();
      return new Promise((resolve) => activeWaiters.push(resolve));
    },
    settledIdle(): Promise<void> {
      if (!active && !queued.length) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },
    history(): readonly IntakeJob[] {
      return [...history, ...(active ? [active] : []), ...queued];
    },
  };
}
