import { hostname } from 'node:os';
import { mkdir, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HttpError } from './errors';
import { Store } from './store';
import { allowedFolder, nextSlot, runMode, validateProject } from './projects';
import { launchJob, stopProcess } from './process';
import type { Run, RunResult } from './types';
import { compareCapture, digest } from './visual';
import { executionEnvironment } from './execution';

export class Workbench {
  private active: ReturnType<typeof launchJob> | null = null;
  private pending: Promise<void> | null = null;
  private closed = false;
  private queueError: string | null = null;
  private mutationTail: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setInterval>;
  private constructor(
    readonly store: Store,
    readonly roots: string[],
    readonly directory: string,
  ) {
    this.store.recover();
    this.timer = setInterval(() => {
      try {
        this.tick();
      } catch {
        /* Leave the durable slot due for the next tick. */
      }
    }, 1000);
    this.timer.unref();
    this.kick();
  }
  static async open(directory: string, roots: string[]) {
    const resolved = await Promise.all(roots.map((root) => realpath(root)));
    if (!resolved.length) throw new Error('At least one workspace root is required');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const lock = join(directory, 'server.lock');
    try {
      const owner = JSON.parse(await readFile(lock, 'utf8')) as { pid: number; host: string };
      let alive = true;
      if (owner.host === hostname() && Number.isInteger(owner.pid) && owner.pid > 0) {
        try {
          process.kill(owner.pid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
        }
      }
      if (alive) throw new Error('Workbench is already running for this state directory');
      await unlink(lock);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await writeFile(lock, JSON.stringify({ pid: process.pid, host: hostname() }), {
      flag: 'wx',
      mode: 0o600,
    });
    try {
      return new Workbench(await Store.open(directory), resolved, directory);
    } catch (error) {
      await unlink(lock);
      throw error;
    }
  }
  state() {
    return {
      projects: this.store.projects(),
      runs: this.store.summaries(),
      roots: this.roots,
      audit: this.store.auditLog(),
      baselines: this.store.baselines(),
      queueError: this.queueError,
    };
  }
  async saveProject(input: Record<string, unknown>, id?: string) {
    const previous = id ? this.store.project(id) : undefined;
    if (id && !previous) throw new HttpError(404, 'Project not found');
    const project = await validateProject(input, this.roots, previous);
    this.store.db.transaction(() => {
      this.store.saveProject(project);
      this.store.audit(previous ? 'project.updated' : 'project.created', project.id);
    })();
    return project;
  }
  enqueue(projectId: string, mode: unknown): Run {
    if (this.closed || this.queueError)
      throw new HttpError(
        503,
        'Run queue is unavailable; restart the server after checking storage',
      );
    const project = this.store.project(projectId);
    if (!project) throw new HttpError(404, 'Project not found');
    if (this.store.activeCount() >= 20) throw new HttpError(429, 'Run queue is full');
    const run = this.store.enqueue(project, runMode(mode))!;
    this.store.audit('run.queued', run.id);
    this.kick();
    return run;
  }
  tick(now = new Date()) {
    if (this.closed || this.queueError) return;
    this.store.db.transaction(() => {
      for (const project of this.store.projects()) {
        if (
          project.paused ||
          !project.nextRunAt ||
          new Date(project.nextRunAt) > now ||
          this.store.activeCount() >= 20
        )
          continue;
        this.store.enqueue(project, project.scheduleMode, `${project.id}:${project.nextRunAt}`);
        this.store.saveProject({ ...project, nextRunAt: nextSlot(project.cron, now) });
        this.store.audit('schedule.enqueued', project.id);
      }
    })();
    this.kick();
  }
  private kick() {
    if (this.pending || this.closed) return;
    this.pending = Promise.resolve()
      .then(() => this.drain())
      .catch(() => {
        this.queueError = 'Run queue stopped unexpectedly. Check storage and restart the server.';
      })
      .finally(() => {
        this.pending = null;
      });
  }
  private async drain() {
    let run: Run | undefined;
    while (!this.closed && (run = this.store.next())) {
      this.store.saveRun({ ...run, state: 'running' });
      let result: RunResult;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await allowedFolder(run.project.folder, this.roots);
        const directory = join(this.directory, 'runs', run.id);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const input = join(directory, 'input.json');
        const output = join(directory, 'result.json');
        await writeFile(input, JSON.stringify(run), { mode: 0o600 });
        if (this.closed || this.store.run(run.id)?.state === 'cancelled')
          throw new Error('Run cancelled before launch');
        const overrides =
          run.mode === 'agent' && run.project.execution
            ? executionEnvironment(run.project.execution, process.env)
            : undefined;
        this.active = launchJob(input, output, overrides);
        timeout = setTimeout(
          () => {
            if (this.active) void stopProcess(this.active.child);
          },
          run.mode === 'agent'
            ? (run.project.execution?.maxRuntimeMinutes ?? 30) * 60_000
            : 5 * 60_000,
        );
        const code = await this.active.finished;
        if (code !== 0) throw new Error('Interrupted engine');
        result = JSON.parse(await readFile(output, 'utf8')) as RunResult;
        if (result.captures)
          for (const capture of result.captures) {
            if (capture.status === 'unstable') continue;
            const baseline = this.store.baseline(run.projectId, capture.specHash);
            if (!baseline) continue;
            const baselineRun = this.store.run(baseline.run_id);
            const previous = baselineRun?.result?.captures?.find(
              (item) => item.id === baseline.capture_id,
            );
            if (!previous) throw new Error('Baseline metadata unavailable');
            const baselinePath = join(this.directory, 'runs', baseline.run_id, previous.file);
            if (digest(await readFile(baselinePath)) !== previous.sha256)
              throw new Error('Baseline integrity failed');
            const diffFile = `${capture.id}.diff.png`;
            const compared = await compareCapture(
              join(directory, capture.file),
              baselinePath,
              join(directory, diffFile),
            );
            Object.assign(capture, compared, {
              status: compared.changedPixels ? 'changed' : 'unchanged',
              baselineRunId: baseline.run_id,
              baselineFile: previous.file,
              diffFile,
            });
          }
      } catch (error) {
        result = {
          outcome: 'blocked',
          summary:
            error instanceof HttpError
              ? error.message
              : 'Run stopped: invalid project, engine failure, cancellation, or runtime limit. Prior baselines were preserved.',
        };
      } finally {
        if (timeout) clearTimeout(timeout);
        this.active = null;
      }
      if (this.store.run(run.id)?.state !== 'cancelled') this.store.finish(run, result);
    }
  }
  async idle() {
    await this.pending;
  }
  async approveBaseline(runId: string, captureId: string) {
    return this.mutate(async () => {
      const run = this.store.run(runId);
      const capture = run?.result?.captures?.find((item) => item.id === captureId);
      if (!run || run.state !== 'completed' || !capture || capture.status === 'unstable')
        throw new HttpError(409, 'Only a completed, stable capture can become a baseline');
      if (
        digest(await readFile(join(this.directory, 'runs', runId, capture.file))) !== capture.sha256
      )
        throw new HttpError(409, 'Capture integrity check failed');
      this.store.db.transaction(() => {
        this.store.approve(run.projectId, capture.specHash, runId, captureId);
        this.store.audit('baseline.approved', `${runId}/${captureId}`);
      })();
    });
  }
  async artifact(runId: string, filename: string) {
    const run = this.store.run(runId);
    const files = new Set(
      (run?.result?.captures ?? []).flatMap((capture) => [
        capture.file,
        `${capture.file}.privacy.json`,
        ...(capture.diffFile ? [capture.diffFile] : []),
      ]),
    );
    if (run?.result?.captures?.length) {
      files.add('timeline.json');
      files.add('timeline.sanitization.json');
    }
    if (!files.has(filename)) throw new HttpError(404, 'Artifact not found');
    return {
      bytes: await readFile(join(this.directory, 'runs', runId, filename)),
      type: filename.endsWith('.png') ? 'image/png' : 'application/json; charset=utf-8',
    };
  }
  async deleteRun(id: string) {
    return this.mutate(async () => {
      const run = this.store.run(id);
      if (!run) throw new HttpError(404, 'Run not found');
      if (['queued', 'running'].includes(run.state) || this.store.referencesBaseline(id))
        throw new HttpError(409, 'Active runs and approved baselines cannot be deleted');
      await rm(join(this.directory, 'runs', id), { recursive: true, force: true });
      this.store.db.transaction(() => {
        this.store.deleteRun(id);
        this.store.audit('run.deleted', id);
      })();
    });
  }
  private mutate<T>(action: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(action);
    this.mutationTail = result.catch(() => undefined);
    return result;
  }
  async cancel(id: string) {
    const run = this.store.run(id);
    if (!run) throw new HttpError(404, 'Run not found');
    if (!['queued', 'running'].includes(run.state))
      throw new HttpError(409, 'Run is already finished');
    this.store.saveRun({
      ...run,
      state: 'cancelled',
      finishedAt: new Date().toISOString(),
      result: { outcome: 'blocked', summary: 'Cancelled by administrator' },
    });
    this.store.audit('run.cancelled', id);
    if (run.state === 'running' && this.active) await stopProcess(this.active.child);
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    if (this.active) await stopProcess(this.active.child);
    await this.pending;
    await this.mutationTail;
    this.store.db.close();
    await unlink(join(this.directory, 'server.lock'));
  }
}
