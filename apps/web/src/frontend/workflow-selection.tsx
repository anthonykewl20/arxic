import { useState } from 'react';
import { Button } from './components';
import { Card } from './components';
import { campaignRequestKey, usePendingRequest } from './pending-requests';
import type { Project, Run } from '../types';

let variantDraftSeed = 0;
/**
 * Variant drafts: persona rows carry ref NAMES only (credential values never
 * enter the browser form); flag rows carry one named boolean; state rows are a
 * fixed anonymous switch.
 */
type VariantKind = 'persona' | 'flag' | 'state';
type VariantDraft = { id: number; kind: VariantKind };

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
            <legend>Execution variants</legend>
            <p className="muted">
              Optional: each selected workflow additionally runs once per variant (up to 4, mixed
              kinds allowed). Persona variants use ARXIC_SECRET_ credential references; feature flag
              variants override one named boolean flag per row; a state variant reruns the workflow
              anonymously. Each scheduled fire repeats the full fan-out.
            </p>
            {variantDrafts.map((draft, index) => {
              // Narrow the draft kind into a local const before the JSX —
              // inline optional chaining in JSX ternaries trips TS2322 here.
              const kind = draft.kind;
              return (
                <div className="variant-fields" key={draft.id}>
                  <label>
                    Variant label
                    <input name="variant-label" maxLength={100} autoComplete="off" />
                  </label>
                  <label>
                    Variant kind
                    <select
                      name="variant-kind"
                      value={kind}
                      onChange={(event) =>
                        setVariantDrafts((drafts) =>
                          drafts.map((item) =>
                            item.id === draft.id
                              ? { ...item, kind: event.target.value as VariantKind }
                              : item,
                          ),
                        )
                      }
                    >
                      <option value="persona">Persona</option>
                      <option value="flag">Feature flag</option>
                      <option value="state">State</option>
                    </select>
                  </label>
                  {kind === 'persona' && (
                    <>
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
                      <label>
                        Variant login route
                        <input
                          name="variant-login-route"
                          placeholder="/login/alternate"
                          autoComplete="off"
                        />
                      </label>
                      <label>
                        Variant login email label
                        <input
                          name="variant-login-email-label"
                          placeholder="Work email"
                          maxLength={100}
                          autoComplete="off"
                        />
                      </label>
                      <label>
                        Variant login password label
                        <input
                          name="variant-login-password-label"
                          placeholder="Passphrase"
                          maxLength={100}
                          autoComplete="off"
                        />
                      </label>
                      <label>
                        Variant login submit label
                        <input
                          name="variant-login-submit-label"
                          placeholder="Sign in"
                          maxLength={100}
                          autoComplete="off"
                        />
                      </label>
                      <small>
                        Optional: this variant logs in through this route instead of the project
                        login route (labels left blank keep the project values).
                      </small>
                    </>
                  )}
                  {kind === 'flag' && (
                    <>
                      <label>
                        Flag name
                        <input
                          name="variant-flag-name"
                          placeholder="new-checkout"
                          maxLength={100}
                          autoComplete="off"
                        />
                      </label>
                      <label>
                        Flag value
                        <select name="variant-flag-value" defaultValue="true">
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      </label>
                    </>
                  )}
                  {kind === 'state' && (
                    <small>Runs this workflow with the anonymous persona (no extra fields).</small>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    className="secondary"
                    data-remove-variant={index}
                    onClick={() =>
                      setVariantDrafts((drafts) => drafts.filter((item) => item.id !== draft.id))
                    }
                  >
                    Remove variant
                  </Button>
                  <small>
                    Variant {index + 1} of {variantDrafts.length}
                  </small>
                </div>
              );
            })}
            <Button
              type="button"
              variant="outline"
              className="secondary"
              disabled={variantDrafts.length >= 4}
              onClick={() =>
                setVariantDrafts((drafts) => [
                  ...drafts,
                  { id: ++variantDraftSeed, kind: 'persona' },
                ])
              }
            >
              Add variant
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
