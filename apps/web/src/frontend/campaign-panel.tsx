import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Note,
  Section,
  type Column,
} from './components';
import { Layers } from 'lucide-react';
import type { Workbench } from '../workbench';

type CampaignView = ReturnType<Workbench['campaign']>;
type CampaignSummary = Omit<CampaignView, 'rows'> & { rows?: CampaignView['rows'] };
export type CampaignPanelProps = {
  campaigns: CampaignSummary[];
  selectedId: string;
  projectId: string;
  pages: Map<string, number>;
  /** Run summaries carrying the rebind discovery's live state. */
  runs: Array<{ id: string; state: string }>;
};

/** In-flight drift rebind: the campaign card carries the discovery run's live state. */
function RebindingBadge({
  campaign,
  runs,
}: {
  campaign: CampaignSummary;
  runs: CampaignPanelProps['runs'];
}) {
  const discoveryRunId = campaign.rebinding?.discoveryRunId;
  if (!discoveryRunId) return null;
  const state = runs.find((run) => run.id === discoveryRunId)?.state;
  return (
    <Badge variant="outline" className="pill rebinding" data-rebinding="true">
      {state ? `Rebinding — discovery run ${state}` : 'Rebinding'}
    </Badge>
  );
}

export function CampaignPanel({
  campaigns,
  selectedId,
  projectId,
  pages,
  runs,
}: CampaignPanelProps) {
  const selected = campaigns.find((campaign) => campaign.id === selectedId);
  const visible = campaigns.filter((campaign) => !projectId || campaign.projectId === projectId);
  return (
    <>
      <Note>
        Start a campaign from Intent inventory after discovery and guided AI setup. Campaigns track
        source surfaces; passing selected workflows does not prove all frontend behavior. Latest 100
        campaigns shown; full records persist.
      </Note>
      {/* The empty state is not a grid item: inside the card grid it would be
          boxed into one column and read as a missing card. */}
      {visible.length ? (
        <div className="project-grid">
          {visible.map((campaign) => (
            <Card className="card" key={campaign.id}>
              <h2>{campaign.projectName}</h2>
              <Badge variant="outline" className={`pill ${campaign.state}`}>
                {campaign.state}
              </Badge>
              <RebindingBadge campaign={campaign} runs={runs} />
              <p>
                {campaign.counts.verified}/{campaign.counts.selected} selected workflows verified ·{' '}
                {campaign.counts.pending} pending
              </p>
              <small>
                {new Date(campaign.createdAt).toISOString().slice(0, 19).replace('T', ' ')} UTC
              </small>
              <p>
                <Button variant="outline" className="secondary" data-open-campaign={campaign.id}>
                  View campaign
                </Button>
              </p>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState icon={Layers} title="No campaigns yet">
          Discover a project&rsquo;s intents, select the workflows worth executing, and start a
          campaign from Intent inventory.
        </EmptyState>
      )}
      {selected?.rows && (
        <CampaignDetail campaign={selected as CampaignView} pages={pages} runs={runs} />
      )}
    </>
  );
}

function CampaignDetail({
  campaign,
  pages,
  runs,
}: {
  campaign: CampaignView;
  pages: Map<string, number>;
  runs: CampaignPanelProps['runs'];
}) {
  const { counts, rows } = campaign;
  const pageSize = 50;
  const page = Math.min(
    pages.get(campaign.id) ?? 0,
    Math.max(0, Math.ceil(rows.length / pageSize) - 1),
  );
  return (
    <section className="campaign-detail">
      <Section
        title={`${campaign.projectName} / campaign`}
        actions={
          counts.pending > 0 ? (
            <Button variant="destructive" className="danger" data-cancel-campaign={campaign.id}>
              Cancel campaign
            </Button>
          ) : undefined
        }
      />
      <Card className="card">
        <Badge variant="outline" className={`pill ${campaign.state}`}>
          {campaign.state}
        </Badge>
        <RebindingBadge campaign={campaign} runs={runs} />
        <p className="campaign-counts">
          {counts.selected} selected · {counts.verified} verified · {counts.contradicted}{' '}
          contradicted · {counts.blocked} blocked · {counts.uncovered} uncovered · {counts.pending}{' '}
          pending
        </p>
        <p>
          {counts.unselected} unselected · {counts.unsupported} not eligible for proposals ·{' '}
          {rows.length} total source surfaces
        </p>
        <p className="folder">Source commit: {campaign.sourceCommit}</p>
        {(() => {
          // Narrowed to a local first: inline optional chains in JSX ternaries
          // trip TS2322 narrowing here (#482).
          const rebound = campaign.rebound;
          if (!rebound) return null;
          return (
            <p className="rebound-outcome" data-rebound={`${rebound.survivors}/${rebound.dropped}`}>
              Rebound — carried over {rebound.survivors} of {rebound.survivors + rebound.dropped}{' '}
              selected, dropped {rebound.dropped}
            </p>
          );
        })()}
        <p className="muted">
          Each verified workflow passed its deterministic verifier. Source surfaces are not a count
          of all business states, personas or feature flags.
        </p>
        <a href={`/api/campaigns/${campaign.id}`} target="_blank" rel="noopener">
          Complete campaign JSON
        </a>
      </Card>
      <SurfaceRows campaign={campaign} rows={rows.slice(page * pageSize, (page + 1) * pageSize)} />
      <div className="toolbar">
        <Button
          variant="outline"
          className="secondary"
          data-campaign-page={campaign.id}
          data-direction="-1"
          disabled={page === 0}
        >
          Previous surfaces
        </Button>
        <small>
          {rows.length ? page * pageSize + 1 : 0}–{Math.min((page + 1) * pageSize, rows.length)} of{' '}
          {rows.length}
        </small>
        <Button
          variant="outline"
          className="secondary"
          data-campaign-page={campaign.id}
          data-direction="1"
          disabled={(page + 1) * pageSize >= rows.length}
        >
          Next surfaces
        </Button>
      </div>
    </section>
  );
}

/**
 * One row per source surface the campaign selected.
 *
 * Deliberately carries no `.pill` badge: the campaign detail's single state
 * badge is how journeys identify the campaign's own state, and a badge per row
 * would make that selector ambiguous. Row state is stated in words instead,
 * which reads better in a table anyway.
 */
function SurfaceRows({ campaign, rows }: { campaign: CampaignView; rows: CampaignView['rows'] }) {
  type Row = CampaignView['rows'][number];
  const runFor = (row: Row) => campaign.workflows.find((item) => item.id === row.runId);
  const columns: ReadonlyArray<Column<Row>> = [
    {
      key: 'surface',
      header: 'Surface',
      width: '26%',
      cell: (row) => (
        <code className="text-[12px] text-[var(--foreground)]">
          {row.method} {row.path}
        </code>
      ),
    },
    {
      key: 'outcome',
      header: 'Outcome',
      width: '32%',
      cell: (row) => {
        const run = runFor(row);
        return (
          <span className="flex flex-col gap-0.5">
            <span>
              {run
                ? `${run.state} · ${run.outcome ?? 'awaiting execution'}${
                    run.history
                      ? ` · ${run.history.verified} verified of ${run.history.executions} executions on this surface`
                      : ''
                  }`
                : row.inventoryRowId
                  ? 'unselected'
                  : row.disposition}
            </span>
            {row.reason && (
              <small className="text-[11px] text-[var(--foreground-muted)]">{row.reason}</small>
            )}
          </span>
        );
      },
    },
    {
      key: 'variants',
      header: 'Variants',
      cell: (row) => {
        // Optional fields narrowed into locals before JSX (TS2322, #482/#489).
        const runIds = row.runIds;
        if (!runIds?.length) return null;
        const variants = campaign.variants;
        return (
          <span className="flex flex-col gap-0.5">
            {runIds.map((id) => {
              const workflow = campaign.workflows.find((item) => item.id === id);
              const key = workflow?.variantKey ?? '';
              const label = variants?.find((item) => item.key === key)?.label ?? key;
              const state = workflow?.state ?? 'blocked';
              return (
                <small
                  key={id}
                  className="variant-outcome text-[11px]"
                  data-variant-outcome={`${key}:${state}`}
                >
                  {label}: {state} · {workflow?.outcome ?? 'awaiting execution'}
                </small>
              );
            })}
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      bare: true,
      cell: (row) => {
        const run = runFor(row);
        if (!run) return null;
        return (
          <span className="flex justify-end">
            <Button variant="outline" size="sm" className="secondary" data-open-run={run.id}>
              Workflow result
            </Button>
          </span>
        );
      },
    },
  ];
  return (
    <DataTable
      className="campaign-rows"
      caption={`Source surfaces in the ${campaign.projectName} campaign`}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.key}
    />
  );
}
