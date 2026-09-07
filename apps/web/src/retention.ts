import { lstat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { RetentionRepository, type RetentionRow } from './retention-store';
import { HttpError } from './errors';
import type { Store } from './store';
export interface RetentionPolicy {
  enabled: boolean;
  maxAgeDays: number;
  keepLatest: number;
}
export const defaultRetention: RetentionPolicy = { enabled: false, maxAgeDays: 30, keepLatest: 20 };
export function retentionPolicy(value: unknown, requireConsent = false): RetentionPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new HttpError(400, 'Invalid retention policy');
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) => !['enabled', 'maxAgeDays', 'keepLatest', 'confirmDeletion'].includes(key),
    ) ||
    typeof input.enabled !== 'boolean' ||
    typeof input.maxAgeDays !== 'number' ||
    !Number.isInteger(input.maxAgeDays) ||
    input.maxAgeDays < 1 ||
    input.maxAgeDays > 3650 ||
    typeof input.keepLatest !== 'number' ||
    !Number.isInteger(input.keepLatest) ||
    input.keepLatest < 1 ||
    input.keepLatest > 1000 ||
    (input.confirmDeletion !== undefined && typeof input.confirmDeletion !== 'boolean')
  )
    throw new HttpError(400, 'Retention requires 1–3650 days and 1–1000 newest runs per project');
  if (requireConsent && input.enabled && input.confirmDeletion !== true)
    throw new HttpError(400, 'Confirm automatic evidence deletion before enabling retention');
  return { enabled: input.enabled, maxAgeDays: input.maxAgeDays, keepLatest: input.keepLatest };
}

const batchLimit = 50;
type CleanupResult = {
  outcome: 'completed' | 'failed';
  at: string;
  deleted: number;
  message?: string;
};
const uuid = (id: string) =>
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(id);
function protection(row: Pick<RetentionRow, 'state' | 'baseline' | 'review' | 'campaign'>) {
  if (!['completed', 'blocked', 'cancelled'].includes(row.state)) return 'active';
  if (row.review) return 'review';
  if (row.campaign) return 'campaign';
  if (row.baseline) return 'baseline';
}
/** Actions own eligibility, authorization, durable deletion intent and failure disposition. */
export class Retention {
  private readonly repository: RetentionRepository;
  constructor(
    private readonly store: Store,
    private readonly directory: string,
  ) {
    this.repository = new RetentionRepository(store.db);
  }
  state() {
    const value = this.repository.read('retention');
    return {
      policy: value ? retentionPolicy(value) : { ...defaultRetention },
      lastCleanup: this.repository.read('retention-last') as CleanupResult | undefined,
      pendingDeletions: this.repository.pending().length,
    };
  }
  save(value: unknown) {
    const policy = retentionPolicy(value, true);
    this.store.db.transaction(() => {
      this.repository.write('retention', policy);
      this.store.audit('retention.policy-saved', policy.enabled ? 'enabled' : 'disabled');
    })();
    return this.state();
  }
  preview(value: unknown = this.state().policy, now = new Date()) {
    const policy = retentionPolicy(value),
      cutoff = now.getTime() - policy.maxAgeDays * 86400000;
    const protectedCounts = {
      active: 0,
      baseline: 0,
      review: 0,
      campaign: 0,
      recent: 0,
      age: 0,
      invalid: 0,
      pending: 0,
    };
    const candidates: Array<
      Pick<RetentionRow, 'id' | 'projectName' | 'mode'> & { finishedAt: string }
    > = [];
    let total = 0,
      candidateCount = 0;
    for (const row of this.repository.rows()) {
      total++;
      const reference = protection(row);
      const timestamp = row.finishedAt ?? row.createdAt;
      const time = Date.parse(timestamp);
      const reason =
        reference ??
        (row.pending
          ? 'pending'
          : !uuid(row.id) || !Number.isFinite(time)
            ? 'invalid'
            : row.rank <= policy.keepLatest
              ? 'recent'
              : time >= cutoff
                ? 'age'
                : undefined);
      if (reason) {
        protectedCounts[reason]++;
        continue;
      }
      candidateCount++;
      if (candidates.length < batchLimit)
        candidates.push({
          id: row.id,
          projectName: row.projectName,
          mode: row.mode,
          finishedAt: timestamp,
        });
    }
    return { policy, total, candidateCount, candidates, protected: protectedCounts, batchLimit };
  }
  async deleteRun(id: string) {
    if (!uuid(id)) throw new HttpError(404, 'Run not found');
    const run = this.store.run(id);
    if (!run) throw new HttpError(404, 'Run not found');
    const reason = protection({
      state: run.state,
      baseline: Number(this.store.referencesBaseline(id)),
      review: Number(this.store.referencesReview(id)),
      campaign: Number(this.store.referencesCampaign(id)),
    });
    if (reason) {
      const messages = {
        active: 'Active runs and approved baselines cannot be deleted',
        baseline: 'Active runs and approved baselines cannot be deleted',
        review: 'Evidence referenced by an AI review cannot be deleted',
        campaign: 'Evidence referenced by a campaign cannot be deleted',
      };
      throw new HttpError(409, messages[reason]);
    }
    this.repository.mark(id);
    try {
      const root = join(this.directory, 'runs');
      try {
        const info = await lstat(root);
        if (!info.isDirectory() || info.isSymbolicLink())
          throw new Error('Unsafe evidence directory');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await rm(join(root, id), { recursive: true, force: true });
      this.store.db.transaction(() => {
        this.store.deleteRun(id);
        this.repository.unmark(id);
        this.store.audit('run.deleted', id);
      })();
    } catch {
      throw this.failedCleanup(0);
    }
  }
  async recover() {
    let deleted = 0;
    try {
      for (const id of this.repository.pending()) {
        if (!uuid(id)) throw new Error('Invalid pending evidence deletion');
        if (!this.store.run(id)) {
          this.repository.unmark(id);
          continue;
        }
        await this.deleteRun(id);
        deleted++;
      }
    } catch {
      throw this.failedCleanup(deleted);
    }
    if (deleted)
      this.repository.write('retention-last', {
        outcome: 'completed',
        at: new Date().toISOString(),
        deleted,
      });
    return deleted;
  }
  async cleanup() {
    if (!this.state().policy.enabled && !this.state().pendingDeletions)
      throw new HttpError(409, 'Automatic retention is disabled');
    let deleted = await this.recover();
    try {
      if (this.state().policy.enabled)
        for (const row of this.preview().candidates) {
          await this.deleteRun(row.id);
          deleted++;
        }
      const result: CleanupResult = { outcome: 'completed', at: new Date().toISOString(), deleted };
      this.repository.write('retention-last', result);
      return result;
    } catch {
      throw this.failedCleanup(deleted);
    }
  }
  private failedCleanup(deleted: number) {
    this.repository.write('retention-last', {
      outcome: 'failed',
      at: new Date().toISOString(),
      deleted,
      message:
        'Evidence cleanup failed; check storage and retry. Authorized deletion will resume after restart.',
    });
    return new HttpError(409, 'Evidence cleanup failed; check storage and retry');
  }
}
