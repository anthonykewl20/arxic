import { actions } from './dashboard-actions';
import { useState } from 'react';
import { ScanSearch } from 'lucide-react';
import {
  Badge,
  Button,
  EmptyState,
  TabPanel,
  Tabs,
  DataTable,
  Input,
  Pagination,
  Section,
  TableScroll,
  type Column,
} from './components';
import { WorkflowSelection } from './workflow-selection';
import type { RowHistory } from '../campaigns';
import {
  configurationOmissions,
  declaredRouteRules,
  routeStateCoverage,
  runtimeStateMap,
  stateCheckpointCoverage,
  type RouteCoverageDimensionName,
  type SurfaceIntentSummary,
} from '../route-coverage';
import { evidenceWords, runModeWords } from '../plain-words';
import type { FrontendInventory } from '@arxic/source-ua-adapter';
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
  /** Surface-keyed union of every campaign execution, from the workbench ledger. */
  outcomes: Record<string, Record<string, RowHistory>>;
  /** Surface-keyed intent-ledger fusion; absent keys are intent omissions. */
  intentOutcomes: Record<string, Record<string, SurfaceIntentSummary>>;
};

export function InventoryPanel(props: InventoryPanelProps) {
  const { projects, runs, projectId, kind, search } = props;
  const [tab, setTab] = useState('surfaces');
  const latest = projects
    .filter((project) => !projectId || project.id === projectId)
    .map((project) => ({
      project,
      run: runs.find(
        (run) => run.projectId === project.id && (run.result?.inventory || run.result?.ledger),
      ),
      discovery: runs.find((run) => run.projectId === project.id && run.result?.frontend),
    }));
  // Counts on the tab strip, so the size of each dimension is visible without
  // opening it.
  const surfaceCount = latest.reduce((total, { run }) => {
    const ledger = run?.result?.ledger as { rows?: unknown[] } | undefined;
    const inventory = run?.result?.inventory as { rows?: unknown[] } | undefined;
    return total + (ledger?.rows?.length ?? inventory?.rows?.length ?? 0);
  }, 0);
  const declarationCount = latest.reduce(
    (total, { discovery }) =>
      total +
      (discovery?.result?.frontend
        ? matchingDeclarations(discovery.result.frontend, kind, search).length
        : 0),
    0,
  );
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
        <form id="declaration-search" className="search-form">
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
      <nav className="toolbar" aria-label="Declaration results">
        {latest.flatMap(({ project, discovery }) =>
          discovery?.result?.frontend
            ? [
                <Button
                  key={project.id}
                  asChild
                  variant="outline"
                  className="min-h-11 max-w-full text-left"
                >
                  <a
                    href={`#declarations-${discovery.id}`}
                    onClick={(event) => {
                      event.preventDefault();
                      // A link that counts declarations should land on them:
                      // open their tab first, then move focus once rendered.
                      setTab('declarations');
                      requestAnimationFrame(() => {
                        const heading = document.getElementById(`declarations-${discovery.id}`);
                        heading?.focus({ preventScroll: true });
                        heading?.scrollIntoView({ block: 'start', behavior: 'instant' });
                      });
                    }}
                  >
                    {matchingDeclarations(discovery.result.frontend, kind, search).length} matching
                    declarations · {project.name}
                  </a>
                </Button>,
              ]
            : [],
        )}
      </nav>
      <p className="scope-note">
        This is what reading your code found: the addresses it serves, the journeys it declares and
        the components behind them. Pages you can look at live under Pages; API endpoints are here
        because nobody can look at one. Reading code cannot recover every rule your application
        follows, and personas, states and flags nothing has exercised stay uncovered rather than
        counted as fine.
      </p>
      {latest.length ? (
        <>
          {/*
            Three dimensions of one inventory, not three things to scroll past.
            Stacked, a project with a real discovery put every surface, every
            workflow and every declaration on one page — sixteen thousand pixels
            of it. The operator picks the dimension instead.
          */}
          <Tabs
            label="Coverage sections"
            value={tab}
            onValueChange={setTab}
            items={[
              { id: 'surfaces', label: 'Pages and endpoints', count: surfaceCount },
              { id: 'workflows', label: 'Workflows to test' },
              { id: 'declarations', label: 'In the code', count: declarationCount },
            ]}
          />
          {latest.map(({ project, run, discovery }) =>
            run ? (
              <section key={project.id} className="flex flex-col gap-4">
                <TabPanel id="surfaces" value={tab}>
                  <SurfaceInventory
                    project={project}
                    run={run}
                    outcomes={props.outcomes[project.id] ?? {}}
                  />
                </TabPanel>
                <TabPanel id="workflows" value={tab}>
                  <WorkflowSelection
                    key={`workflows:${discovery?.id ?? 'missing'}`}
                    project={project}
                    discovery={discovery}
                    selections={props.selections}
                    pages={props.workflowPages}
                  />
                </TabPanel>
                <TabPanel id="declarations" value={tab}>
                  {discovery && (
                    <FrontendDeclarations
                      key={`declarations:${discovery.id}`}
                      run={discovery}
                      kind={kind}
                      search={search}
                      pages={props.declarationPages}
                      intentOutcomes={props.intentOutcomes[project.id] ?? {}}
                    />
                  )}
                </TabPanel>
              </section>
            ) : (
              <EmptyState key={project.id} icon={ScanSearch} title={project.name}>
                <p>Nothing has been read from this project&rsquo;s code yet.</p>
                <Button
                  className="primary mt-2"
                  data-start="discovery"
                  data-project={project.id}
                  onClick={() => actions().startRun(project.id, 'discovery')}
                >
                  Read the code
                </Button>
              </EmptyState>
            ),
          )}
        </>
      ) : (
        <EmptyState icon={ScanSearch} title="No connected projects">
          Connect a project and run source discovery to build its intent inventory.
        </EmptyState>
      )}
    </>
  );
}

/** Surfaces are paged in the client: a discovery can carry thousands of rows. */
const SURFACE_PAGE = 25;

function SurfaceInventory({
  project,
  run,
  outcomes,
}: {
  project: Project;
  run: Run;
  outcomes: Record<string, RowHistory>;
}) {
  const [offset, setOffset] = useState(0);
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
  const start = Math.min(offset, Math.max(0, rows.length - 1));
  const page = rows.slice(start, start + SURFACE_PAGE);
  type Row = (typeof rows)[number];
  const columns: ReadonlyArray<Column<Row>> = [
    {
      key: 'surface',
      header: 'Address',
      width: '24%',
      cell: (row) => (
        <code className="text-[12px] text-[var(--foreground)]">
          {row.method} {row.path}
        </code>
      ),
    },
    {
      key: 'domain',
      header: 'Area',
      cell: (row) => (
        <span className="flex flex-col gap-0.5">
          <span>{row.domain}</span>
          {row.intents?.map((intent) => (
            <small key={intent.proposalId} className="text-[11px] text-[var(--foreground-muted)]">
              {intent.intent} · {intent.truthState}
            </small>
          ))}
        </span>
      ),
    },
    {
      key: 'disposition',
      header: 'How we know',
      cell: (row) => (
        // Badge and disposition sit on one line: stacked, they set the row
        // height for every surface in the table.
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <Badge
            variant="outline"
            className={`pill ${row.truthState} shrink-0`}
            title={evidenceWords(row.truthState).detail}
          >
            {evidenceWords(row.truthState).label}
          </Badge>
          <small className="text-[11px] text-[var(--foreground-muted)]">{row.disposition}</small>
        </span>
      ),
    },
    {
      key: 'ledger',
      header: 'Tested',
      width: '18%',
      // The execution history is stated in the cell, not hidden behind a title:
      // a tooltip is not reachable by keyboard or reliably announced, and
      // "never executed" is exactly what an operator scanning for gaps needs.
      cell: (row) => {
        const history = outcomes[row.key];
        return (
          <span data-row-ledger={row.key}>
            {history ? (
              <small>
                {history.verified} verified of {history.executions} executions across campaigns
                {history.contradicted ? ` · ${history.contradicted} contradicted` : ''}
                {history.blocked ? ` · ${history.blocked} blocked` : ''}
              </small>
            ) : (
              <small className="text-[var(--foreground-muted)]">
                Not chosen for a workflow run yet.
              </small>
            )}
          </span>
        );
      },
    },
    {
      key: 'evidence',
      header: 'Found in',
      width: '30%',
      truncate: true,
      cell: (row) => {
        // The first reference is the one an operator opens; the rest stay
        // reachable on the title rather than costing two more lines per row.
        const [first, ...rest] = row.sourceRefs;
        const all = row.sourceRefs.map((ref) => `${ref.path}:${ref.startLine}`).join('\n');
        return (
          <span className="flex flex-col gap-0.5">
            <span>{row.reason}</span>
            {first && (
              <small className="flex items-baseline gap-1 text-[11px]" title={all}>
                <span className="min-w-0 truncate">
                  {first.path}:{first.startLine}
                </span>
                {rest.length > 0 && (
                  <span className="shrink-0 tabular-nums text-[var(--foreground-muted)]">
                    +{rest.length}
                  </span>
                )}
              </small>
            )}
            {row.intents?.length === 0 && (
              <small className="text-[11px] text-[var(--foreground-muted)]">
                No intent proposal for this surface.
              </small>
            )}
          </span>
        );
      },
    },
  ];
  return (
    <Section
      title={project.name}
      meta={`${rows.length} addresses · ${runModeWords(run.mode).label.toLowerCase()} · ${new Date(run.createdAt).toISOString().slice(0, 19).replace('T', ' ')} UTC`}
    >
      <DataTable
        className="surface-inventory"
        caption={`Discovered surfaces for ${project.name}`}
        columns={columns}
        rows={page}
        rowKey={(row) => row.key}
      />
      {rows.length > SURFACE_PAGE && (
        <Pagination
          offset={start}
          count={page.length}
          total={rows.length}
          unit="surfaces"
          onPage={(direction) =>
            setOffset((value) =>
              Math.max(0, Math.min(value + direction * SURFACE_PAGE, rows.length - 1)),
            )
          }
        />
      )}
    </Section>
  );
}

const dimensionLabels: Record<RouteCoverageDimensionName, string> = {
  'state:loading': 'loading',
  'state:error': 'error',
  'state:empty': 'empty',
  actions: 'actions',
  tests: 'tests',
  docs: 'docs',
};

/** Per-route omission chips derived from the run's own discovery artifacts. */
function RouteOmissionCoverage({
  inventory,
  frontend,
  project,
  runtimeStates,
  runtimeObservationGap,
  intentOutcomes,
}: {
  inventory: DomainInventory;
  frontend: FrontendInventory;
  project: Project;
  runtimeStates?: NonNullable<Run['result']>['runtimeStates'];
  runtimeObservationGap?: string;
  intentOutcomes: Record<string, SurfaceIntentSummary>;
}) {
  const coverage = routeStateCoverage(inventory, frontend);
  const configOmissions = configurationOmissions(project, inventory, frontend);
  const runtimeMapping = runtimeStates ? runtimeStateMap(coverage, runtimeStates) : undefined;
  const checkpointMatrix = stateCheckpointCoverage(
    inventory,
    frontend,
    project.stateCaptures ?? [],
  );
  const rulesByPath = new Map(
    declaredRouteRules(inventory, frontend).map((route) => [
      `${route.method} ${route.path}`,
      route,
    ]),
  );
  if (!coverage.length) return null;
  return (
    <section className="route-coverage" data-route-coverage>
      <div className="section-heading">
        <h2>Route omission coverage</h2>
        <small>{coverage.length} routes · source-reference exposure</small>
      </div>
      <p className="scope-note">
        Per route: which conditional states and interactive actions its own source files reference,
        and whether any test or documentation declaration covers them. An absent marker is an
        omission signal to investigate — not proof of absent behavior.
      </p>
      <ul>
        {coverage.slice(0, 50).map((route) => (
          <li key={`${route.method} ${route.path}`} data-route={route.path}>
            <code>
              {route.method} {route.path}
            </code>{' '}
            {route.dimensions.map((dimension) => (
              <span
                key={dimension.name}
                className={
                  dimension.status === 'referenced' ? 'coverage-referenced' : 'coverage-absent'
                }
              >
                {dimensionLabels[dimension.name]}{' '}
                {dimension.status === 'referenced' ? (
                  <small>
                    referenced
                    {dimension.evidence[0]
                      ? ` (${dimension.evidence[0].path}:${dimension.evidence[0].startLine})`
                      : ''}
                  </small>
                ) : (
                  <small>absent</small>
                )}
              </span>
            ))}
            {(() => {
              const key = `${route.method} ${route.path}`;
              const rules = rulesByPath.get(key);
              const intents = intentOutcomes[key];
              return (
                <span className="route-rules" data-route-rules={route.path}>
                  {rules && !rules.omission ? (
                    rules.rules.map((rule) => (
                      <small key={rule.kind}>
                        {rule.kind.replace('rule:', '')} ({rule.evidence.length})
                      </small>
                    ))
                  ) : (
                    <small>no declared rules</small>
                  )}
                  <small>
                    {intents
                      ? `intents: ${intents.intents} · ${intents.bestTruthState} · ${intents.replayStatus}`
                      : 'no intent proposal yet'}
                  </small>
                </span>
              );
            })()}
          </li>
        ))}
      </ul>
      {coverage.length > 50 && (
        <p className="scope-note">
          First 50 routes shown; the complete inventory JSON preserves every route.
        </p>
      )}
      {runtimeObservationGap && (
        <p className="scope-note" data-runtime-gap>
          Runtime state observation skipped: {runtimeObservationGap}. Point the project at a running
          test app to map source-declared states onto rendered ones.
        </p>
      )}
      {runtimeMapping && (
        <div className="runtime-mapping" data-runtime-mapping>
          <h3>Runtime state mapping</h3>
          <p className="scope-note">
            What plain navigation of the running app actually rendered, mapped onto the source
            declarations above. Plain navigation cannot provoke every conditional: a
            declared-unobserved state may still exist behind data or sign-in, and an
            observed-undeclared marker means the runtime shows something no source declaration
            accounts for.
          </p>
          <ul>
            {runtimeMapping
              .filter((route) =>
                route.dimensions.some(({ mapping }) => mapping !== 'unobserved-undeclared'),
              )
              .map((route) => (
                <li key={`${route.method} ${route.path}`} data-route={route.path}>
                  <code>
                    {route.method} {route.path}
                  </code>{' '}
                  {route.dimensions
                    .filter(({ mapping }) => mapping !== 'unobserved-undeclared')
                    .map((dimension) => (
                      <span key={dimension.name} className={`runtime-${dimension.mapping}`}>
                        {dimensionLabels[dimension.name]} <small>{dimension.mapping}</small>
                      </span>
                    ))}
                </li>
              ))}
          </ul>
        </div>
      )}
      {checkpointMatrix.length > 0 && (
        <div className="state-checkpoints" data-state-checkpoints>
          <h3>State checkpoints</h3>
          <p className="scope-note">
            Per route and state: whether the source declares it, and whether a declared state
            checkpoint captures it. Declared states without checkpoints are the capturable omissions
            — plain navigation may never provoke them.
          </p>
          <ul>
            {checkpointMatrix.map((route) => (
              <li key={`${route.method} ${route.path}`} data-checkpoint-route={route.path}>
                <code>
                  {route.method} {route.path}
                </code>{' '}
                {route.dimensions
                  .filter((cell) => cell.declared || cell.checkpoint)
                  .map((cell) => (
                    <span
                      key={cell.name}
                      className={cell.checkpoint ? 'coverage-referenced' : 'coverage-absent'}
                    >
                      {dimensionLabels[cell.name]}{' '}
                      <small>
                        {cell.checkpoint
                          ? 'checkpoint'
                          : cell.declared
                            ? 'declared, no checkpoint'
                            : 'checkpoint only'}
                      </small>
                    </span>
                  ))}
              </li>
            ))}
          </ul>
        </div>
      )}
      {configOmissions.length > 0 && (
        <div className="config-omissions" data-config-omissions>
          <h3>Configuration omissions</h3>
          <p className="scope-note">
            What this project declares fused with what discovery found — a declared flag no source
            file reads, a source flag no deployment declares, or a persona route the app does not
            have. These are configuration-vs-source misalignments, not proof of absent behavior.
          </p>
          <ul>
            {configOmissions.map((entry) => (
              <li key={entry.key}>
                <code>{entry.key}</code>{' '}
                <small>
                  {entry.status}
                  {entry.evidence[0]
                    ? ` (${entry.evidence[0].path}:${entry.evidence[0].startLine})`
                    : ''}
                </small>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function matchingDeclarations(inventory: FrontendInventory, kind: string, search: string) {
  return inventory.rows.filter(
    (row) =>
      (!kind || row.kind === kind) &&
      `${row.label} ${row.source.path}`.toLowerCase().includes(search.toLowerCase()),
  );
}

function FrontendDeclarations({
  run,
  kind,
  search,
  pages,
  intentOutcomes,
}: {
  run: Run;
  kind: string;
  search: string;
  pages: Map<string, number>;
  intentOutcomes: Record<string, SurfaceIntentSummary>;
}) {
  const inventory = run.result?.frontend;
  if (!inventory) return null;
  // Historical inventories can persist duplicate row IDs from the earlier
  // identity format; key rows by immutable inventory position so duplicate IDs
  // never collide as React keys and retained evidence stays unchanged.
  const rowKeys = new Map(inventory.rows.map((row, index) => [row, `${index}:${row.id}`]));
  const matches = matchingDeclarations(inventory, kind, search);
  const pageSize = 25;
  const page = Math.min(
    pages.get(run.id) ?? 0,
    Math.max(0, Math.ceil(matches.length / pageSize) - 1),
  );
  return (
    <section className="frontend-inventory">
      <div className="section-heading">
        <h2 id={`declarations-${run.id}`} tabIndex={-1} className="declaration-heading">
          Frontend declarations
        </h2>
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
      <TableScroll>
        <table
          className="table data-table w-full border-collapse text-left text-[13px]"
          data-frontend-rows
        >
          <caption className="sr-only">Frontend declarations</caption>
          <thead className="[&_th]:border-b [&_th]:border-[var(--border)]">
            <tr>
              <th
                scope="col"
                className="h-9 px-3 text-[12px] font-medium text-[var(--foreground-muted)]"
              >
                Kind
              </th>
              <th
                scope="col"
                className="h-9 px-3 text-[12px] font-medium text-[var(--foreground-muted)]"
              >
                Declaration
              </th>
              <th
                scope="col"
                className="h-9 px-3 text-[12px] font-medium text-[var(--foreground-muted)]"
              >
                Source evidence
              </th>
            </tr>
          </thead>
          <tbody className="[&_tr:not(:last-child)_td]:border-b [&_td]:border-[var(--border-subtle)]">
            {matches.length ? (
              matches.slice(page * pageSize, (page + 1) * pageSize).map((row) => (
                <tr key={rowKeys.get(row) ?? row.id}>
                  <td data-label="Kind" className="px-3 py-1.5 align-top whitespace-nowrap">
                    {row.kind}
                    <small className="block text-[11px] text-[var(--foreground-muted)]">
                      {row.basis} · hypothesized
                    </small>
                  </td>
                  <td data-label="Declaration" className="px-3 py-1.5 align-top">
                    {row.label}
                  </td>
                  <td data-label="Source evidence" className="px-3 py-1.5 align-top">
                    <span className="folder block truncate" title={row.source.path}>
                      {row.source.path}:{row.source.startLine}–{row.source.endLine}
                    </span>
                    <small
                      className="block text-[11px] text-[var(--foreground-muted)]"
                      title={row.source.blobSha256}
                    >
                      SHA-256 {row.source.blobSha256.slice(0, 12)}
                    </small>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-[var(--foreground-muted)]">
                  No declarations match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableScroll>
      <div className="toolbar">
        <Button
          variant="outline"
          className="secondary"
          data-declaration-page={run.id}
          data-direction="-1"
          disabled={page === 0}
          onClick={() => actions().pageDeclarations(run.id, -1)}
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
          onClick={() => actions().pageDeclarations(run.id, 1)}
          disabled={(page + 1) * pageSize >= matches.length}
        >
          Next declarations
        </Button>
        <a href={`/api/runs/${run.id}`} target="_blank" rel="noopener">
          Complete inventory JSON
        </a>
      </div>
      {(() => {
        const routeInventory = run.result?.inventory as DomainInventory | undefined;
        return (
          routeInventory && (
            <RouteOmissionCoverage
              inventory={routeInventory}
              frontend={inventory}
              project={run.project}
              runtimeStates={run.result?.runtimeStates}
              runtimeObservationGap={run.result?.runtimeObservationGap}
              intentOutcomes={intentOutcomes}
            />
          )
        );
      })()}
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
