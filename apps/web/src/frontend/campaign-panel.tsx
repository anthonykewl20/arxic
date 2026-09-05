import { Button } from './components/ui/button';
import { Card } from './components/ui/card';
import { Badge } from './components/ui/badge';
import type { Workbench } from '../workbench';

type CampaignView = ReturnType<Workbench['campaign']>;
type CampaignSummary = Omit<CampaignView, 'rows'> & { rows?: CampaignView['rows'] };
export type CampaignPanelProps = {
  campaigns: CampaignSummary[];
  selectedId: string;
  projectId: string;
  pages: Map<string, number>;
};

export function CampaignPanel({ campaigns, selectedId, projectId, pages }: CampaignPanelProps) {
  const selected = campaigns.find((campaign) => campaign.id === selectedId);
  const visible = campaigns.filter((campaign) => !projectId || campaign.projectId === projectId);
  return (
    <>
      <p className="scope-note">
        Start a campaign from Intent inventory after discovery and guided AI setup. Campaigns track
        source surfaces; passing selected workflows does not prove all frontend behavior. Latest 100
        campaigns shown; full records persist.
      </p>
      <div className="project-grid">
        {visible.length ? (
          visible.map((campaign) => (
            <Card className="card" key={campaign.id}>
              <h2>{campaign.projectName}</h2>
              <Badge variant="outline" className={`pill ${campaign.state}`}>
                {campaign.state}
              </Badge>
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
          ))
        ) : (
          <p>No campaigns yet.</p>
        )}
      </div>
      {selected?.rows && <CampaignDetail campaign={selected as CampaignView} pages={pages} />}
    </>
  );
}

function CampaignDetail({
  campaign,
  pages,
}: {
  campaign: CampaignView;
  pages: Map<string, number>;
}) {
  const { counts, rows } = campaign;
  const pageSize = 50;
  const page = Math.min(
    pages.get(campaign.id) ?? 0,
    Math.max(0, Math.ceil(rows.length / pageSize) - 1),
  );
  return (
    <section className="campaign-detail">
      <div className="section-heading">
        <h2>{campaign.projectName} / campaign</h2>
        {counts.pending > 0 && (
          <Button variant="destructive" className="danger" data-cancel-campaign={campaign.id}>
            Cancel campaign
          </Button>
        )}
      </div>
      <Card className="card">
        <Badge variant="outline" className={`pill ${campaign.state}`}>
          {campaign.state}
        </Badge>
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
        <p className="muted">
          Each verified workflow passed its deterministic verifier. Source surfaces are not a count
          of all business states, personas or feature flags.
        </p>
        <a href={`/api/campaigns/${campaign.id}`} target="_blank" rel="noopener">
          Complete campaign JSON
        </a>
      </Card>
      <ul className="campaign-rows">
        {rows.slice(page * pageSize, (page + 1) * pageSize).map((row) => {
          const run = campaign.workflows.find((item) => item.id === row.runId);
          return (
            <li key={row.key}>
              <div>
                <strong>
                  {row.method} {row.path}
                </strong>
                <small>
                  {run
                    ? `${run.state} · ${run.outcome ?? 'awaiting execution'}`
                    : row.inventoryRowId
                      ? 'unselected'
                      : row.disposition}
                </small>
                {row.reason && <small>{row.reason}</small>}
              </div>
              {run && (
                <Button variant="outline" className="secondary" data-open-run={run.id}>
                  Workflow result
                </Button>
              )}
            </li>
          );
        })}
      </ul>
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
