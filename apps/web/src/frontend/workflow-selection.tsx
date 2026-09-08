import { useState } from 'react';
import { Button } from './components';
import { Card } from './components';
import { campaignRequestKey, usePendingRequest } from './pending-requests';
import type { Project, Run } from '../types';

let variantDraftSeed = 0;
/** Persona variant drafts: ref NAMES only; credential values never enter the browser form. */
type VariantDraft = { id: number };

export function WorkflowSelection({
  project,
  discovery,
  selections,
  pages,
}: {
  project: Project;
  discovery?: Run;
  selections: Map<string, Set<string>>;
  pages: Map<string, number>;
}) {
  const pending = usePendingRequest(campaignRequestKey(project.id, discovery?.id ?? ''));
  const [variantDrafts, setVariantDrafts] = useState<VariantDraft[]>([]);
  const rows = discovery?.result?.workflowRows;
  if (!discovery || !rows)
    return <p className="scope-note">Run source discovery again to enable workflow selection.</p>;
  if (!project.execution)
    return (
      <Card className="workflow-selection card">
        <h2>Select workflows</h2>
        <p>Save guided AI settings to start a campaign.</p>
        <Button variant="outline" className="secondary" data-edit={project.id}>
          Configure campaign settings
        </Button>
      </Card>
    );
  const selected = selections.get(discovery.id) ?? new Set<string>();
  const pageSize = 50;
  const page = Math.min(
    pages.get(discovery.id) ?? 0,
    Math.max(0, Math.ceil(rows.length / pageSize) - 1),
  );
  return (
    <Card className="workflow-selection card">
      <h2>Select workflows</h2>
      <p className="muted">
        Choose up to 20 source surfaces. Each selected surface gets a separate AI execution attempt
        with two verifier replays. Unsupported routes and unselected surfaces stay in the coverage
        record.
      </p>
      <form
        data-campaign-form="true"
        data-project={project.id}
        data-discovery={discovery.id}
        aria-busy={pending}
      >
        <fieldset disabled={pending} className="review-fields">
          <ul className="workflow-choices">
            {rows.slice(page * pageSize, (page + 1) * pageSize).map((row) => (
              <li key={row.key}>
                {row.inventoryRowId ? (
                  <label>
                    <input
                      type="checkbox"
                      data-workflow-row="true"
                      data-discovery={discovery.id}
                      value={row.inventoryRowId}
                      defaultChecked={selected.has(row.inventoryRowId)}
                    />
                    Select {row.method} {row.path}
                  </label>
                ) : (
                  <>
                    <span>
                      {row.method} {row.path}
                    </span>
                    <small>
                      {row.disposition} · {row.reason}
                    </small>
                  </>
                )}
              </li>
            ))}
          </ul>
          <div className="toolbar">
            <Button
              type="button"
              variant="outline"
              className="secondary"
              data-workflow-page={discovery.id}
              data-direction="-1"
              disabled={page === 0}
            >
              Previous surfaces
            </Button>
            <small>
              {rows.length ? page * pageSize + 1 : 0}–{Math.min((page + 1) * pageSize, rows.length)}{' '}
              of {rows.length}
            </small>
            <Button
              type="button"
              variant="outline"
              className="secondary"
              data-workflow-page={discovery.id}
              data-direction="1"
              disabled={(page + 1) * pageSize >= rows.length}
            >
              Next surfaces
            </Button>
          </div>
          <p className="scope-note">
            {selected.size} selected. Maximum planning estimate: $
            {(selected.size * project.execution.modelBudgetUsd).toFixed(4)} across these attempts;
            host-agent billing may be unreported. Runs are serialized and use the saved persona and
            deployment settings.
          </p>
          <fieldset className="variant-editor">
            <legend>Persona variants</legend>
            <p className="muted">
              Optional: each selected workflow additionally runs once per persona variant, using the
              variant's ARXIC_SECRET_ credential references (up to 4). Variant campaigns run once.
            </p>
            {variantDrafts.map((draft, index) => (
              <div className="variant-fields" key={draft.id}>
                <label>
                  Variant label
                  <input name="variant-label" maxLength={100} autoComplete="off" />
                </label>
                <label>
                  Variant email secret reference
                  <input
                    name="variant-email"
                    placeholder="ARXIC_SECRET_PERSONA_EMAIL"
                    autoComplete="off"
                  />
                </label>
                <label>
                  Variant password secret reference
                  <input
                    name="variant-password"
                    placeholder="ARXIC_SECRET_PERSONA_PASSWORD"
                    autoComplete="off"
                  />
                </label>
                <Button
                  type="button"
                  variant="outline"
                  className="secondary"
                  data-remove-variant={index}
                  onClick={() =>
                    setVariantDrafts((drafts) => drafts.filter((item) => item.id !== draft.id))
                  }
                >
                  Remove persona variant
                </Button>
                <small>
                  Variant {index + 1} of {variantDrafts.length}
                </small>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              className="secondary"
              disabled={variantDrafts.length >= 4}
              onClick={() => setVariantDrafts((drafts) => [...drafts, { id: ++variantDraftSeed }])}
            >
              Add persona variant
            </Button>
          </fieldset>
          <Button type="submit" className="primary" disabled={selected.size === 0}>
            Start selected campaign
          </Button>
        </fieldset>
        {pending && <p role="status">Submitting campaign…</p>}
      </form>
    </Card>
  );
}
