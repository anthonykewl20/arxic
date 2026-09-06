import type Database from 'better-sqlite3';
/** One reference projection serves individual deletion and whole-history retention. */
export const runReferenceCtes = `baseline_refs AS (
 SELECT run_id AS id FROM baselines UNION
 SELECT json_extract(capture.value, '$.baselineRunId') FROM runs, json_each(runs.data, '$.result.captures') AS capture WHERE json_extract(capture.value, '$.baselineRunId') IS NOT NULL
), review_refs AS (
 SELECT DISTINCT json_extract(data, '$.visualReview.sourceRunId') AS id FROM runs WHERE json_extract(data, '$.visualReview.sourceRunId') IS NOT NULL
), campaign_refs AS (
 SELECT json_extract(data, '$.discoveryRunId') AS id FROM campaigns UNION
 SELECT child.value FROM campaigns, json_each(campaigns.data, '$.runIds') AS child
)`;
export function hasRunReference(
  db: Database.Database,
  kind: 'baseline' | 'review' | 'campaign',
  id: string,
): boolean {
  return !!db
    .prepare(`WITH ${runReferenceCtes} SELECT 1 FROM ${kind}_refs WHERE id=? LIMIT 1`)
    .get(id);
}
export interface RetentionRow {
  id: string;
  projectId: string;
  projectName: string;
  mode: string;
  state: string;
  finishedAt: string | null;
  createdAt: string;
  rank: number;
  baseline: number;
  review: number;
  campaign: number;
  pending: number;
}
export class RetentionRepository {
  constructor(private readonly db: Database.Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS pending_deletions (run_id TEXT PRIMARY KEY);`);
  }
  read(key: string): unknown {
    const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as
      { value: string } | undefined;
    return row ? JSON.parse(row.value) : undefined;
  }
  write(key: string, value: unknown) {
    this.db
      .prepare(
        'INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, JSON.stringify(value));
  }
  pending() {
    return (
      this.db.prepare('SELECT run_id FROM pending_deletions ORDER BY rowid').all() as Array<{
        run_id: string;
      }>
    ).map((row) => row.run_id);
  }
  mark(id: string) {
    this.db.prepare('INSERT OR IGNORE INTO pending_deletions VALUES (?)').run(id);
  }
  unmark(id: string) {
    this.db.prepare('DELETE FROM pending_deletions WHERE run_id=?').run(id);
  }
  *rows(): Generator<RetentionRow> {
    const statement = this.db.prepare(`WITH ${runReferenceCtes}, ranked AS (
 SELECT id, project_id AS projectId, state, json_extract(data,'$.project.name') AS projectName,
 json_extract(data,'$.mode') AS mode, json_extract(data,'$.finishedAt') AS finishedAt, json_extract(data,'$.createdAt') AS createdAt,
 ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY CASE WHEN state IN ('completed','blocked','cancelled') THEN 0 ELSE 1 END, COALESCE(json_extract(data,'$.finishedAt'),json_extract(data,'$.createdAt')) DESC, rowid DESC) AS rank FROM runs
 ) SELECT ranked.*, b.id IS NOT NULL AS baseline, r.id IS NOT NULL AS review, c.id IS NOT NULL AS campaign, p.run_id IS NOT NULL AS pending
 FROM ranked LEFT JOIN baseline_refs b ON b.id=ranked.id LEFT JOIN review_refs r ON r.id=ranked.id LEFT JOIN campaign_refs c ON c.id=ranked.id LEFT JOIN pending_deletions p ON p.run_id=ranked.id
 ORDER BY COALESCE(finishedAt,createdAt), ranked.id`);
    for (const row of statement.iterate()) yield row as RetentionRow;
  }
}
