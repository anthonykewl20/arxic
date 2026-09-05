import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';
import { Input } from './components/ui/input';
import { WorkflowSelection } from './workflow-selection';
import type { DomainInventory } from '@arxic/domain-inventory';
import type { IntentLedger } from '../../../../packages/intent/src/ledger';
import type { Project, Run } from '../types';

export type InventoryPanelProps = {
  projects: Project[];
  runs: Run[];
  projectId: string;
  kind: string;
  search: string;
  declarationPages: Map<string, number>;
  selections: Map<string, Set<string>>;
  workflowPages: Map<string, number>;
};

export function InventoryPanel(props: InventoryPanelProps) {
  const { projects, runs, projectId, kind, search } = props;
  const latest = projects
    .filter((project) => !projectId || project.id === projectId)
    .map((project) => ({
      project,
      run: runs.find(
        (run) => run.projectId === project.id && (run.result?.inventory || run.result?.ledger),
      ),
      discovery: runs.find((run) => run.projectId === project.id && run.result?.frontend),
    }));
  return (
    <>
      <div className="toolbar">
        <select id="project-filter" aria-label="Filter by project" defaultValue={projectId}>
          <option value="">All projects</option>
          {projects.map((project) => (
            <option value={project.id} key={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <select id="declaration-kind" aria-label="Declaration kind" defaultValue={kind}>
          <option value="">All declarations</option>
          {[
            'component',
            'control',
            'condition',
            'state',
            'action',
            'requirement',
            'test',
            'configuration',
            'feature-flag',
          ].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <form id="declaration-search">
          <Input
            aria-label="Search declarations"
            name="query"
            defaultValue={search}
            placeholder="Declaration or source file"
            maxLength={200}
          />
          <Button type="submit" variant="outline" className="secondary">
            Search
          </Button>
        </form>
      </div>
      <p className="scope-note">
        Source discovery inventories routes and frontend declarations with explicit gaps; it does
        not recover every business rule. AI E2E adds evidence-grounded proposals and replay
        outcomes. Unseen personas, states, flags, and pages remain uncovered.
      </p>
      {latest.length ? (
        latest.map(({ project, run, discovery }) => (
          <section key={project.id}>
            {run ? (
              <>
                <SurfaceInventory project={project} run={run} />
                <WorkflowSelection
                  key={`workflows:${discovery?.id ?? 'missing'}`}
                  project={project}
                  discovery={discovery}
                  selections={props.selections}
                  pages={props.workflowPages}
                />
                {discovery && (
                  <FrontendDeclarations
                    key={`declarations:${discovery.id}`}
                    run={discovery}
                    kind={kind}
                    search={search}
                    pages={props.declarationPages}
                  />
                )}
              </>
            ) : (
              <div className="empty">
                <h2>{project.name}</h2>
                <p className="muted">No inventory yet.</p>
                <Button className="primary" data-start="discovery" data-project={project.id}>
                  Discover intents
                </Button>
              </div>
            )}
          </section>
        ))
      ) : (
        <div className="empty">
          <h2>No connected projects</h2>
        </div>
      )}
    </>
  );
}

function SurfaceInventory({ project, run }: { project: Project; run: Run }) {
  // Typed views over the server-produced persisted artifacts.
  // Their source references have distinct shapes; project them explicitly.
  const ledger = run.result?.ledger as IntentLedger | undefined;
  const inventory = run.result?.inventory as DomainInventory | undefined;
  const rows = ledger
    ? ledger.rows.map((row) => ({
        key: row.inventoryKey,
        method: row.surface.method,
        path: row.surface.path,
        domain: row.domain,
        truthState: row.truthState,
        disposition: row.disposition,
        reason: row.reason,
        sourceRefs: row.evidence.sourceRefs,
        intents: row.intents,
      }))
    : (inventory?.rows ?? []).map((row) => ({
        ...row,
        truthState: 'hypothesized',
        intents: undefined,
      }));
  return (
    <>
      <div className="section-heading">
        <h2>{project.name}</h2>
        <small>
          {rows.length} known surfaces · {run.mode} ·{' '}
          {new Date(run.createdAt).toISOString().slice(0, 19).replace('T', ' ')} UTC
        </small>
      </div>
      <div className="panel">
        <table className="table surface-inventory">
          <thead>
            <tr>
              <th>SURFACE</th>
              <th>DOMAIN / INTENT</th>
              <th>DISPOSITION</th>
              <th>EVIDENCE / GAP</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td data-label="SURFACE">
                  {row.method} {row.path}
                </td>
                <td data-label="DOMAIN / INTENT">
                  {row.domain}
                  {row.intents?.map((intent) => (
                    <small key={intent.proposalId}>
                      {intent.intent} · {intent.truthState}
                    </small>
                  ))}
                </td>
                <td data-label="DISPOSITION">
                  <Badge variant="outline" className={`pill ${row.truthState}`}>
                    {row.truthState}
                  </Badge>
                  <small>{row.disposition}</small>
                </td>
                <td data-label="EVIDENCE / GAP">
                  {row.reason}
                  {row.sourceRefs.slice(0, 3).map((ref, index) => (
                    <small key={`${ref.path}:${ref.startLine}:${index}`}>
                      {ref.path}:{ref.startLine}
                    </small>
                  ))}
                  {row.intents?.length === 0 && <small>No intent proposal for this surface.</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function FrontendDeclarations({
  run,
  kind,
  search,
  pages,
}: {
  run: Run;
  kind: string;
  search: string;
  pages: Map<string, number>;
}) {
  const inventory = run.result?.frontend;
  if (!inventory) return null;
  const matches = inventory.rows.filter(
    (row) =>
      (!kind || row.kind === kind) &&
      `${row.label} ${row.source.path}`.toLowerCase().includes(search.toLowerCase()),
  );
  const pageSize = 100;
  const page = Math.min(
    pages.get(run.id) ?? 0,
    Math.max(0, Math.ceil(matches.length / pageSize) - 1),
  );
  return (
    <section className="frontend-inventory">
      <div className="section-heading">
        <h2>Frontend declarations</h2>
        <small>
          {inventory.rows.length} hypotheses · {inventory.coverage.analyzedFiles}/
          {inventory.coverage.enumeratedFiles} files analyzed
        </small>
      </div>
      <div className="scope-note">
        Source declarations describe possible behavior. Runtime coverage is still missing for:{' '}
        {inventory.coverage.unobservedDimensions.join(', ')}. Git-ignored files are outside this
        scan. Source revision: <code>{inventory.revision.commit}</code>
        {inventory.revision.dirty && ' · Uncommitted files excluded'}.
      </div>
      <div className="panel">
        <table className="table" data-frontend-rows>
          <thead>
            <tr>
              <th>KIND</th>
              <th>DECLARATION</th>
              <th>SOURCE EVIDENCE</th>
            </tr>
          </thead>
          <tbody>
            {matches.length ? (
              matches.slice(page * pageSize, (page + 1) * pageSize).map((row) => (
                <tr key={row.id}>
                  <td data-label="KIND">
                    {row.kind}
                    <small>{row.basis} · hypothesized</small>
                  </td>
                  <td data-label="DECLARATION">{row.label}</td>
                  <td data-label="SOURCE EVIDENCE">
                    {row.source.path}:{row.source.startLine}–{row.source.endLine}
                    <small title={row.source.blobSha256}>
                      SHA-256 {row.source.blobSha256.slice(0, 12)}
                    </small>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={3}>No declarations match these filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="toolbar">
        <Button
          variant="outline"
          className="secondary"
          data-declaration-page={run.id}
          data-direction="-1"
          disabled={page === 0}
        >
          Previous declarations
        </Button>
        <small>
          {matches.length ? page * pageSize + 1 : 0}–
          {Math.min((page + 1) * pageSize, matches.length)} of {matches.length}
        </small>
        <Button
          variant="outline"
          className="secondary"
          data-declaration-page={run.id}
          data-direction="1"
          disabled={(page + 1) * pageSize >= matches.length}
        >
          Next declarations
        </Button>
        <a href={`/api/runs/${run.id}`} target="_blank" rel="noopener">
          Complete inventory JSON
        </a>
      </div>
      <details data-detail-key={`${run.id}-gaps`}>
        <summary>Coverage gaps</summary>
        <p>
          {inventory.gaps.length} file gaps. First 100 shown; the complete JSON preserves every gap
          and per-file row count. Scan limits: {inventory.coverage.fileLimit} eligible files,{' '}
          {inventory.coverage.rowLimit} declarations.
        </p>
        <ul>
          {inventory.gaps.slice(0, 100).map((gap, index) => (
            <li key={`${gap.path}:${index}`}>
              {gap.path} · {gap.reason}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
