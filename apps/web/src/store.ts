import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Campaign, Project, Run, RunResult } from './types';

export class Store {
  private constructor(readonly db: Database.Database) {}
  static async open(directory: string) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const databasePath = join(directory, 'workbench.sqlite');
    const db = new Database(databasePath);
    await chmod(databasePath, 0o600);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.exec(`CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, state TEXT NOT NULL, slot TEXT UNIQUE, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS baselines (project_id TEXT NOT NULL, spec TEXT NOT NULL, run_id TEXT NOT NULL, capture_id TEXT NOT NULL, PRIMARY KEY(project_id, spec));
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, at TEXT NOT NULL, action TEXT NOT NULL, subject TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS campaigns (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS run_state ON runs(state);`);
    return new Store(db);
  }
  projects(): Project[] {
    return this.documents<Project>('SELECT data FROM projects ORDER BY rowid DESC');
  }
  runs(): Run[] {
    return this.documents<Run>('SELECT data FROM runs ORDER BY rowid DESC LIMIT 200');
  }
  summaries(): Array<Run & { hasInventory: boolean; hasLedger: boolean }> {
    return this.documents(
      `SELECT json_set(json_remove(data, '$.result.inventory', '$.result.workflowRows', '$.result.frontend', '$.result.manifest', '$.result.ledger', '$.result.engineRun', '$.result.diagnostics'), '$.hasInventory', json_type(data, '$.result.inventory') IS NOT NULL, '$.hasLedger', json_type(data, '$.result.ledger') IS NOT NULL) AS data FROM runs ORDER BY rowid DESC LIMIT 200`,
    );
  }
  project(id: string): Project | undefined {
    return this.document<Project>('SELECT data FROM projects WHERE id = ?', id);
  }
  run(id: string): Run | undefined {
    return this.document<Run>('SELECT data FROM runs WHERE id = ?', id);
  }
  campaigns(): Campaign[] {
    return this.documents<Campaign>('SELECT data FROM campaigns ORDER BY rowid DESC LIMIT 100');
  }
  campaign(id: string): Campaign | undefined {
    return this.document<Campaign>('SELECT data FROM campaigns WHERE id = ?', id);
  }
  saveCampaign(campaign: Campaign) {
    this.db
      .prepare(
        'INSERT INTO campaigns VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      )
      .run(campaign.id, JSON.stringify(campaign));
  }
  referencesCampaign(runId: string): boolean {
    return !!this.db
      .prepare(
        "SELECT 1 FROM campaigns WHERE json_extract(data, '$.discoveryRunId')=? UNION ALL SELECT 1 FROM campaigns, json_each(campaigns.data, '$.runIds') AS child WHERE child.value=? LIMIT 1",
      )
      .get(runId, runId);
  }
  saveProject(project: Project) {
    this.db
      .prepare(
        'INSERT INTO projects VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      )
      .run(project.id, JSON.stringify(project));
  }
  saveRun(run: Run) {
    this.db
      .prepare('UPDATE runs SET state=?, data=? WHERE id=?')
      .run(run.state, JSON.stringify(run), run.id);
  }
  enqueue(project: Project, mode: Run['mode'], slot?: string): Run | null {
    const run: Run = {
      id: randomUUID(),
      projectId: project.id,
      mode,
      state: 'queued',
      createdAt: new Date().toISOString(),
      finishedAt: null,
      project,
      result: null,
    };
    const inserted = this.db
      .prepare('INSERT OR IGNORE INTO runs VALUES (?, ?, ?, ?, ?)')
      .run(run.id, project.id, 'queued', slot ?? null, JSON.stringify(run));
    return inserted.changes ? run : null;
  }
  next(): Run | undefined {
    return this.document<Run>("SELECT data FROM runs WHERE state='queued' ORDER BY rowid LIMIT 1");
  }
  activeCount(): number {
    return (
      this.db
        .prepare("SELECT count(*) AS count FROM runs WHERE state IN ('queued', 'running')")
        .get() as { count: number }
    ).count;
  }
  finish(run: Run, result: RunResult) {
    this.saveRun({
      ...run,
      state: result.outcome === 'blocked' ? 'blocked' : 'completed',
      finishedAt: new Date().toISOString(),
      result,
    });
  }
  recover() {
    for (const run of this.documents<Run>("SELECT data FROM runs WHERE state='running'"))
      this.finish(run, {
        outcome: 'blocked',
        summary: 'Server stopped during this run. Start a new run to retry.',
      });
  }
  baseline(projectId: string, spec: string): { run_id: string; capture_id: string } | undefined {
    return this.db
      .prepare('SELECT run_id, capture_id FROM baselines WHERE project_id=? AND spec=?')
      .get(projectId, spec) as { run_id: string; capture_id: string } | undefined;
  }
  referencesBaseline(runId: string): boolean {
    return !!this.db
      .prepare(
        "SELECT 1 FROM baselines WHERE run_id=? UNION ALL SELECT 1 FROM runs, json_each(runs.data, '$.result.captures') AS capture WHERE json_extract(capture.value, '$.baselineRunId')=? LIMIT 1",
      )
      .get(runId, runId);
  }
  deleteRun(runId: string) {
    this.db.prepare('DELETE FROM runs WHERE id=?').run(runId);
  }
  approve(projectId: string, spec: string, runId: string, captureId: string) {
    this.db
      .prepare(
        'INSERT INTO baselines VALUES (?, ?, ?, ?) ON CONFLICT(project_id, spec) DO UPDATE SET run_id=excluded.run_id, capture_id=excluded.capture_id',
      )
      .run(projectId, spec, runId, captureId);
  }
  audit(action: string, subject: string) {
    this.db
      .prepare('INSERT INTO audit(at, action, subject) VALUES (?, ?, ?)')
      .run(new Date().toISOString(), action, subject);
  }
  auditLog() {
    return this.db
      .prepare('SELECT at, action, subject FROM audit ORDER BY id DESC LIMIT 100')
      .all();
  }
  baselines() {
    return this.db.prepare('SELECT project_id, spec, run_id, capture_id FROM baselines').all();
  }
  private documents<T>(query: string): T[] {
    return (this.db.prepare(query).all() as Array<{ data: string }>).map(
      (row) => JSON.parse(row.data) as T,
    );
  }
  private document<T>(query: string, ...args: string[]): T | undefined {
    const row = this.db.prepare(query).get(...args) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as T) : undefined;
  }
}
