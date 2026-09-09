import { planVisualMatrix } from './visual-matrix';
import { Retention } from './retention';
import { readEvidenceFile } from './evidence-files';
import { readWorkflowArtifact } from './workflow-captures';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { HttpError } from './errors';
import { Store } from './store';
import { allowedFolder, inside, nextSlot, runMode, validateProject } from './projects';
import { launchJob, stopProcess } from './process';
import type { Campaign, Project, Run, RunResult } from './types';

/** Only the two sign-in secrets reach the visual job; every other ARXIC_SECRET_ is stripped. */
export function loginEnvironment(login: NonNullable<Project['login']>, env: NodeJS.ProcessEnv) {
  const overrides: NodeJS.ProcessEnv = {};
  for (const key of [login.emailRef, login.passwordRef]) if (env[key]) overrides[key] = env[key];
  return overrides;
}

/**
 * Execution environment for a campaign agent run: the base execution settings
 * for default runs, plus the variant persona's credential overrides for
 * variant runs. Credential VALUES are read from the process environment here
 * and only here — they never enter project/run JSON, just the launch env.
 * An unresolvable variant or unset secret throws, which lands the run in the
 * blocked outcome rather than silently running as the default persona.
 */
export function variantEnvironment(
  run: Pick<Run, 'workflowScope'>,
  campaign: Campaign | undefined,
  settings: ExecutionSettings,
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const base = executionEnvironment(settings, env);
  const variantKey = run.workflowScope?.variantKey;
  if (!variantKey) return base;
  const variant = campaign?.variants?.find((item) => item.key === variantKey);
  if (!variant)
    throw new HttpError(
      400,
      `Campaign variant could not be resolved: ${variantKey}; refusing to run as the default persona`,
    );
  // Flag and state variants carry no credential payload: the unmodified base
  // environment (their divergence happens in the child's engine config).
  if (variant.kind !== 'persona') return base;
  return {
    ...base,
    ...secretEnvironment(
      [
        [variant.persona.emailRef, 'ARXIC_INPUT_PERSONA_EMAIL'],
        [variant.persona.passwordRef, 'ARXIC_INPUT_PERSONA_PASSWORD'],
      ],
      env,
    ),
  };
}

/**
 * Non-secret variant payload stamped next to variantKey on the workflow scope:
 * flag variants record their boolean overrides, state variants record the
 * anonymous switch, persona variants with a login override record that form
 * declaration (route + labels; credentials stay env-only).
 */
function variantScopePayload(
  variant: NonNullable<Campaign['variants']>[number],
): Pick<NonNullable<Run['workflowScope']>, 'variantFlags' | 'variantState' | 'variantLogin'> {
  if (variant.kind === 'flag') return { variantFlags: { ...variant.flags } };
  if (variant.kind === 'state') return { variantState: 'anonymous' };
  return {
    ...(variant.login
      ? {
          variantLogin: {
            route: variant.login.route,
            ...(variant.login.emailLabel ? { emailLabel: variant.login.emailLabel } : {}),
            ...(variant.login.passwordLabel ? { passwordLabel: variant.login.passwordLabel } : {}),
            ...(variant.login.submitLabel ? { submitLabel: variant.login.submitLabel } : {}),
          },
        }
      : {}),
  };
}

/** Campaign copy with the transient rebind marker removed once a rebind settles. */
function withoutRebinding(campaign: Campaign): Campaign {
  const copy: Campaign = { ...campaign };
  delete copy.rebinding;
  return copy;
}
/** Five minutes plus a per-capture allowance; crawl, sign-in and stability retries need headroom. */
export function visualRuntimeLimit(project: Project) {
  const pages = project.pageMode === 'discover' ? project.maxPages : project.paths.length;
  const { environments, pageBudget } = planVisualMatrix(project);
  const captures = Math.min(pages, pageBudget) * project.viewports.length * environments.length;
  return Math.min(60 * 60_000, 5 * 60_000 + captures * 6_000);
}
import { compareCapture, digest } from './visual';
import { explainFromAssessment } from './diff-explanation';
import { classifyAgainstBaseline } from './structural-diff';
import {
  executionEnvironment,
  secretEnvironment,
  secretRef,
  type ExecutionSettings,
} from './execution';
import {
  connectionCredentialRef,
  modelConnections,
  modelEnvironment,
  validateConnection,
} from './model-connections';
import { SecretStore } from './secret-store';
import { toProposalConsumerInventory, type DomainInventory } from '@arxic/domain-inventory';
import { sourceRevision } from './source';
import { campaignRows, campaignView, rowHistoryOf, type RowHistory } from './campaigns';
import { unionIntentCoverage } from './route-coverage';
import { reviewImage, type VisualReviewScope } from './visual-review';

/** Single source of truth for the workflow-scope drift refusal (throw site, run record, schedule stop). */
const sourceDriftRefusal =
  'Source changed since campaign discovery; commit changes and start a new campaign';

/**
 * Sad-path-first variant validation; each refusal is a distinct 400 fired
 * before anything is enqueued. Entries are a persona | flag | state union
 * (mixed-kind lists allowed); returns the normalized variant list.
 */
function validateCampaignVariants(input: unknown): NonNullable<Campaign['variants']> {
  if (input === undefined) return [];
  if (!Array.isArray(input))
    throw new HttpError(400, 'Campaign variants must be a list of variant definitions');
  if (input.length > 4) throw new HttpError(400, 'A campaign supports at most 4 variants');
  const variants: NonNullable<Campaign['variants']> = [];
  for (const item of input) {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new HttpError(400, 'Campaign variants must be a list of variant definitions');
    const entry = item as Record<string, unknown>;
    const kind = entry.kind;
    const payloadKey =
      kind === 'flag' ? 'flags' : kind === 'state' ? 'state' : kind === 'persona' ? 'persona' : '';
    if (!payloadKey) throw new HttpError(400, 'Unsupported variant kind');
    // `login` is a persona-only key: on flag/state entries it falls through to
    // the same foreign-payload 400 as every other misplaced key.
    const allowedKeys = [
      'key',
      'label',
      'kind',
      payloadKey,
      ...(kind === 'persona' ? ['login'] : []),
    ];
    if (Object.keys(entry).some((key) => !allowedKeys.includes(key)))
      throw new HttpError(400, 'Campaign variants must be a list of variant definitions');
    const key = entry.key;
    const label = entry.label;
    if (typeof key !== 'string' || !/^[a-z0-9-]+$/u.test(key))
      throw new HttpError(400, 'Variant keys use lowercase letters, digits and dashes');
    if (typeof label !== 'string' || !label.trim() || label.trim().length > 100)
      throw new HttpError(400, 'Variant labels must be non-empty text of at most 100 characters');
    if (kind === 'persona') {
      const persona = entry.persona as { emailRef?: unknown; passwordRef?: unknown } | undefined;
      if (
        !persona ||
        typeof persona !== 'object' ||
        Array.isArray(persona) ||
        Object.keys(persona).some((name) => !['emailRef', 'passwordRef'].includes(name)) ||
        typeof persona.emailRef !== 'string' ||
        !persona.emailRef.startsWith('ARXIC_SECRET_') ||
        typeof persona.passwordRef !== 'string' ||
        !persona.passwordRef.startsWith('ARXIC_SECRET_')
      )
        throw new HttpError(
          400,
          'Variant credentials must reference ARXIC_SECRET_ environment names',
        );
      // Optional non-secret login override: a route plus at most three short
      // form labels; absent fields keep the project login surface's values.
      let login:
        | { route: string; emailLabel?: string; passwordLabel?: string; submitLabel?: string }
        | undefined;
      if (entry.login !== undefined) {
        const raw = entry.login as Record<string, unknown> | undefined;
        if (
          !raw ||
          typeof raw !== 'object' ||
          Array.isArray(raw) ||
          Object.keys(raw).some(
            (name) => !['route', 'emailLabel', 'passwordLabel', 'submitLabel'].includes(name),
          )
        )
          throw new HttpError(400, 'A variant login override must be a login form declaration');
        if (typeof raw.route !== 'string' || !raw.route)
          throw new HttpError(400, 'A variant login override requires a route');
        if (!raw.route.startsWith('/'))
          throw new HttpError(400, 'A variant login route must start with /');
        if (
          ['emailLabel', 'passwordLabel', 'submitLabel'].some(
            (name) =>
              raw[name] !== undefined &&
              (typeof raw[name] !== 'string' || !raw[name].trim() || raw[name].trim().length > 100),
          )
        )
          throw new HttpError(400, 'Variant login labels must be short non-empty text');
        login = {
          route: raw.route,
          ...(typeof raw.emailLabel === 'string' ? { emailLabel: raw.emailLabel.trim() } : {}),
          ...(typeof raw.passwordLabel === 'string'
            ? { passwordLabel: raw.passwordLabel.trim() }
            : {}),
          ...(typeof raw.submitLabel === 'string' ? { submitLabel: raw.submitLabel.trim() } : {}),
        };
      }
      variants.push({
        key,
        label: label.trim(),
        kind: 'persona',
        persona: { emailRef: persona.emailRef, passwordRef: persona.passwordRef },
        ...(login ? { login } : {}),
      });
    } else if (kind === 'flag') {
      const flags = entry.flags;
      if (
        !flags ||
        typeof flags !== 'object' ||
        Array.isArray(flags) ||
        Object.keys(flags).length < 1 ||
        Object.keys(flags).length > 30
      )
        throw new HttpError(400, 'Flag variants must declare 1–30 named boolean flags');
      if (Object.keys(flags).some((name) => !/^[A-Za-z][A-Za-z0-9_.-]{0,99}$/u.test(name)))
        throw new HttpError(400, 'Flag names use letters, digits, dot, dash or underscore');
      if (Object.values(flags).some((value) => typeof value !== 'boolean'))
        throw new HttpError(400, 'Flag values must be booleans');
      variants.push({ key, label: label.trim(), kind: 'flag', flags: { ...flags } });
    } else if (entry.state !== 'anonymous') {
      throw new HttpError(400, 'The only supported state variant is anonymous');
    } else {
      variants.push({ key, label: label.trim(), kind: 'state', state: 'anonymous' });
    }
  }
  if (new Set(variants.map((variant) => variant.key)).size !== variants.length)
    throw new HttpError(400, 'Variant keys must be unique');
  return variants;
}

export class Workbench {
  private maintenance = false;
  private runningId: string | null = null;
  private nextRetentionAt = Date.now() + 60_000;
  private active: ReturnType<typeof launchJob> | null = null;
  private pending: Promise<void> | null = null;
  private closed = false;
  private queueError: string | null = null;
  private mutationTail: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setInterval>;
  private readonly providerSecrets: SecretStore;
  private constructor(
    readonly store: Store,
    startupRoots: string[],
    readonly directory: string,
    private readonly retention: Retention,
  ) {
    this.store.recover();
    const deltas = this.store.setting<{ added: string[]; removed: string[] }>(
      'workspace.roots',
    ) ?? { added: [], removed: [] };
    this.roots = [
      ...startupRoots.filter((root) => !deltas.removed.includes(root)),
      ...deltas.added,
    ];
    this.providerSecrets = new SecretStore(store.db, directory);
    this.timer = setInterval(() => {
      void this.guardDueCampaigns()
        .then(() => this.tick())
        .catch(() => {
          /* Leave the durable slot due for the next tick. */
        });
    }, 1000);
    this.timer.unref();
    this.kick();
  }
  /** Operator-widened allow-list: re-executes the startup list plus durable deltas. */
  roots: string[];
  async addWorkspaceRoot(input: unknown) {
    const resolved = await this.requestedRoot(input);
    if (this.roots.some((root) => inside(root, resolved) || inside(resolved, root)))
      throw new HttpError(409, 'Workspace root overlaps a configured root');
    const deltas = this.store.setting<{ added: string[]; removed: string[] }>(
      'workspace.roots',
    ) ?? { added: [], removed: [] };
    deltas.added = [...deltas.added.filter((root) => root !== resolved), resolved];
    deltas.removed = deltas.removed.filter((root) => root !== resolved);
    this.store.saveSetting('workspace.roots', deltas);
    this.roots = [...this.roots, resolved];
    this.store.audit('workspace.root-added', resolved);
    return { roots: this.roots };
  }
  async removeWorkspaceRoot(input: unknown) {
    const resolved = await this.requestedRoot(input);
    if (!this.roots.includes(resolved))
      throw new HttpError(404, 'Workspace root is not configured');
    const dependent = this.store
      .projects()
      .find((project) => project.folder === resolved || inside(resolved, project.folder));
    if (dependent)
      throw new HttpError(409, `Project ${dependent.name} still uses this workspace root`);
    const deltas = this.store.setting<{ added: string[]; removed: string[] }>(
      'workspace.roots',
    ) ?? { added: [], removed: [] };
    deltas.removed = [...deltas.removed.filter((root) => root !== resolved), resolved];
    deltas.added = deltas.added.filter((root) => root !== resolved);
    this.store.saveSetting('workspace.roots', deltas);
    this.roots = this.roots.filter((root) => root !== resolved);
    this.store.audit('workspace.root-removed', resolved);
    return { roots: this.roots };
  }
  private async requestedRoot(input: unknown) {
    const path = (input as { path?: unknown } | null)?.path;
    if (typeof path !== 'string' || !isAbsolute(path))
      throw new HttpError(400, 'Workspace root must be an absolute folder path');
    return realpath(path).catch(() => {
      throw new HttpError(400, 'Workspace root must exist on this server');
    });
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
      const store = await Store.open(directory);
      try {
        for (const run of store.runs())
          if (run.state === 'running')
            await rm(join(directory, 'runs', run.id, '.model-images'), {
              recursive: true,
              force: true,
            });
        const retention = new Retention(store, await realpath(directory));
        await retention.recover();
        return new Workbench(store, resolved, directory, retention);
      } catch (error) {
        store.db.close();
        throw error;
      }
    } catch (error) {
      await unlink(lock);
      throw error;
    }
  }
  /**
   * Surface-keyed execution ledger: every campaign-scoped run of a row unions
   * across the project's campaigns (originals and recurring fires), keyed by
   * the inventory row key the intents panel renders.
   */
  rowOutcomes(): Record<string, Record<string, RowHistory>> {
    const outcomes: Record<string, Record<string, RowHistory>> = {};
    const campaignsByProject = new Map<string, Campaign[]>();
    for (const campaign of this.store.campaigns()) {
      const list = campaignsByProject.get(campaign.projectId) ?? [];
      list.push(campaign);
      campaignsByProject.set(campaign.projectId, list);
    }
    for (const [projectId, campaigns] of campaignsByProject) {
      const keyByRowId = new Map<string, string>();
      for (const campaign of campaigns)
        for (const row of campaign.rows)
          if (row.inventoryRowId) keyByRowId.set(row.inventoryRowId, row.key);
      if (!keyByRowId.size) continue;
      const runsByKey = new Map<string, Run[]>();
      for (const run of this.store.scopedRuns(projectId)) {
        const key = keyByRowId.get(run.workflowScope?.inventoryRowId ?? '');
        if (!key) continue;
        const list = runsByKey.get(key) ?? [];
        list.push(run);
        runsByKey.set(key, list);
      }
      if (!runsByKey.size) continue;
      const project = (outcomes[projectId] ??= {});
      for (const [key, runs] of runsByKey) project[key] = rowHistoryOf(runs);
    }
    return outcomes;
  }
  /**
   * Surface-keyed intent-ledger fusion: every agent run's persisted ledger
   * (full-record reads; the summary projection strips ledgers) unions per
   * ledger surface key, exposing which routes have grounded AI proposals.
   */
  intentOutcomes(): Record<
    string,
    Record<string, import('./route-coverage').SurfaceIntentSummary>
  > {
    const outcomes: Record<
      string,
      Record<string, import('./route-coverage').SurfaceIntentSummary>
    > = {};
    for (const summary of this.store.summaries()) {
      if (summary.mode !== 'agent') continue;
      const run = this.store.run(summary.id);
      const rows = (run?.result as { ledger?: { rows?: unknown[] } } | undefined)?.ledger?.rows as
        import('./route-coverage').LedgerFusionRow[] | undefined;
      if (!rows?.length) continue;
      const project = (outcomes[run!.projectId] ??= {});
      for (const [key, summaryRow] of unionIntentCoverage(rows)) project[key] = summaryRow;
    }
    return outcomes;
  }
  state() {
    return {
      projects: this.store.projects(),
      runs: this.store.summaries(),
      roots: this.roots,
      audit: this.store.auditLog(),
      baselines: this.store.baselines(),
      baselineApprovals: this.store.approvalHistory(),
      queueError: this.queueError,
      outcomes: this.rowOutcomes(),
      intentOutcomes: this.intentOutcomes(),
      campaigns: this.store.campaigns().map((item) => {
        return { ...this.campaign(item.id), rows: undefined };
      }),
    };
  }
  retentionState() {
    return this.retention.state();
  }
  /**
   * Runtime-entered credentials complete the environment; an explicit operator
   * variable keeps precedence.
   *
   * An EMPTY variable is not an override. A shell profile that exports
   * `ARXIC_SECRET_X=` would otherwise shadow a credential stored in the vault
   * with nothing at all, and the run would refuse with "set it in the server
   * environment" — pointing the operator away from the value they had just
   * entered in the dashboard.
   */
  effectiveEnv(): NodeJS.ProcessEnv {
    const merged: NodeJS.ProcessEnv = this.providerSecrets.all();
    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) continue;
      if (value === '' && merged[key]) continue;
      merged[key] = value;
    }
    return merged;
  }
  /**
   * Every ARXIC_SECRET_ reference the workspace actually uses, with where it is
   * used and whether it currently resolves. Names and resolution status only —
   * a credential VALUE never leaves the server, not even to the administrator
   * who entered it.
   *
   * `environment` wins over `vault` because effectiveEnv() gives the operator's
   * own process environment precedence; saying so stops an operator debugging a
   * stored value that is being shadowed.
   */
  credentialInventory() {
    const stored = new Set(this.providerSecrets.refs());
    const uses = new Map<string, string[]>();
    const add = (ref: string | undefined, where: string) => {
      if (!ref) return;
      uses.set(ref, [...(uses.get(ref) ?? []), where]);
    };
    for (const project of this.store.projects()) {
      if (project.login) {
        add(project.login.emailRef, `${project.name} · sign-in email`);
        add(project.login.passwordRef, `${project.name} · sign-in password`);
      }
      add(project.execution?.modelSecretRef, `${project.name} · AI model key`);
    }
    for (const campaign of this.store.campaigns())
      for (const variant of campaign.variants ?? [])
        if (variant.kind === 'persona') {
          add(variant.persona.emailRef, `${campaign.projectName} · ${variant.label} email`);
          add(variant.persona.passwordRef, `${campaign.projectName} · ${variant.label} password`);
        }
    return {
      keySource: this.providerSecrets.keySource,
      keyPath: this.providerSecrets.keyPath,
      credentials: [...uses.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([ref, where]) => ({
          ref,
          uses: [...new Set(where)],
          status: process.env[ref]
            ? ('environment' as const)
            : stored.has(ref)
              ? ('vault' as const)
              : ('missing' as const),
        })),
      // Stored refs nothing references any more: dead credentials the operator
      // can clear. Provider connection keys are managed on their own screen.
      orphaned: [...stored].filter((ref) => !uses.has(ref)).sort(),
    };
  }
  /** Store a sign-in credential under an ARXIC_SECRET_ reference. Write-only: never read back. */
  async saveSecret(input: unknown) {
    return this.mutate(async () => {
      const record = input as { ref?: unknown; value?: unknown } | null;
      const ref = secretRef(record?.ref);
      if (!ref) throw new HttpError(400, 'Name the ARXIC_SECRET_ reference to store');
      const value = typeof record?.value === 'string' ? record.value : '';
      if (!value || value.length > 5000)
        throw new HttpError(400, 'Provide the credential as text between 1 and 5000 characters');
      this.providerSecrets.set(ref, value);
      this.store.audit('secret.set', ref);
      return this.credentialInventory();
    });
  }
  async removeSecret(input: unknown) {
    return this.mutate(async () => {
      const ref = secretRef((input as { ref?: unknown } | null)?.ref);
      if (!ref) throw new HttpError(400, 'Name the ARXIC_SECRET_ reference to remove');
      this.providerSecrets.remove(ref);
      this.store.audit('secret.removed', ref);
      return this.credentialInventory();
    });
  }
  async saveProviderSecret(input: unknown) {
    return this.mutate(async () => {
      const record = input as { connection?: unknown; value?: unknown } | null;
      const ref = connectionCredentialRef(record?.connection, this.effectiveEnv());
      const value = typeof record?.value === 'string' ? record.value.trim() : '';
      if (!value || value.length > 5000)
        throw new HttpError(400, 'Provide the provider key as text between 1 and 5000 characters');
      this.providerSecrets.set(ref, value);
      this.store.audit('provider.secret-set', ref);
      return { modelConnections: modelConnections(this.effectiveEnv()) };
    });
  }
  async removeProviderSecret(input: unknown) {
    return this.mutate(async () => {
      const ref = connectionCredentialRef(
        (input as { connection?: unknown } | null)?.connection,
        this.effectiveEnv(),
      );
      this.providerSecrets.remove(ref);
      this.store.audit('provider.secret-removed', ref);
      return { modelConnections: modelConnections(this.effectiveEnv()) };
    });
  }
  async saveRetention(input: unknown) {
    return this.mutate(async () => this.retention.save(input));
  }
  previewRetention(input?: unknown) {
    return this.retention.preview(input);
  }
  async cleanupRetention() {
    return this.maintain(() => this.retention.cleanup());
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
    this.requireQueueCapacity(1);
    const project = this.store.project(projectId);
    if (!project) throw new HttpError(404, 'Project not found');
    const selected = runMode(mode);
    const run = this.store.enqueue(
      selected === 'visual' && project.pageMode === 'discover'
        ? { ...project, paths: this.discoveredPaths(project) }
        : project,
      selected,
    )!;
    this.store.audit('run.queued', run.id);
    this.kick();
    return run;
  }
  /** Static GET routes from the newest completed source discovery, merged with configured paths. */
  discoveredPaths(project: Project): string[] {
    const discovery = this.store
      .runs()
      .find(
        (run) =>
          run.projectId === project.id && run.mode === 'discovery' && run.state === 'completed',
      );
    const rows = discovery ? (this.store.run(discovery.id)?.result?.workflowRows ?? []) : [];
    const found = rows
      .filter((row) => row.method.toUpperCase() === 'GET')
      .map((row) => row.path.trim())
      .filter(
        (path) =>
          path.startsWith('/') &&
          !path.startsWith('//') &&
          !/[:{}*\\?#\s]/u.test(path) &&
          !path.startsWith('/api/'),
      );
    return [...new Set([...project.paths, ...found])].slice(0, project.maxPages);
  }
  async enqueueVisualReview(runId: string, input: Record<string, unknown>) {
    return this.mutate(async () => {
      this.requireQueueCapacity(1);
      if (input.inspectedAndAuthorized !== true)
        throw new HttpError(
          400,
          'You must inspect the screenshot and authorize sharing its pixels',
        );
      if (
        Object.keys(input).some(
          (key) =>
            ![
              'captureId',
              'sha256',
              'inspectedAndAuthorized',
              'model',
              'modelConnection',
              'budgetUsd',
              'acceptanceCriterion',
              'modelSecretRef',
            ].includes(key),
        ) ||
        typeof input.model !== 'string' ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._:/[\]-]{0,119}$/u.test(input.model) ||
        typeof input.budgetUsd !== 'number' ||
        !Number.isFinite(input.budgetUsd) ||
        input.budgetUsd <= 0 ||
        input.budgetUsd > 100 ||
        typeof input.acceptanceCriterion !== 'string' ||
        input.acceptanceCriterion.length > 2000
      )
        throw new HttpError(400, 'Invalid image review settings');
      const source = this.store.run(runId);
      const capture = source?.result?.captures?.find((c) => c.id === input.captureId);
      if (
        !source ||
        source.mode !== 'visual' ||
        source.state !== 'completed' ||
        !capture ||
        capture.status === 'unstable'
      )
        throw new HttpError(409, 'A completed stable visual capture is required');
      if (input.sha256 !== capture.sha256)
        throw new HttpError(409, 'The screenshot changed; inspect it again');
      const scope: VisualReviewScope = {
        sourceRunId: runId,
        capture,
        inspectedAndAuthorizedAt: new Date().toISOString(),
        model: input.model,
        modelConnection: validateConnection(input.modelConnection),
        modelSecretRef: secretRef(input.modelSecretRef),
        budgetUsd: input.budgetUsd,
        acceptanceCriterion: input.acceptanceCriterion.trim(),
      };
      await reviewImage(join(this.directory, 'runs'), scope);
      const run = this.store.db.transaction(() => {
        this.requireQueueCapacity(1);
        const review = this.store.enqueue(source.project, 'review')!;
        review.visualReview = scope;
        this.store.saveRun(review);
        this.store.audit('visual-review.authorized-and-queued', review.id);
        return review;
      })();
      this.kick();
      return run;
    });
  }
  async enqueueCampaign(projectId: string, input: Record<string, unknown>) {
    return this.mutate(() => this.queueCampaign(projectId, input));
  }
  private async queueCampaign(projectId: string, input: Record<string, unknown>) {
    this.requireQueueCapacity(0);
    const discovery =
      typeof input.discoveryRunId === 'string' ? this.store.run(input.discoveryRunId) : undefined;
    if (
      !discovery ||
      discovery.projectId !== projectId ||
      discovery.mode !== 'discovery' ||
      discovery.state !== 'completed' ||
      !discovery.result?.inventory
    )
      throw new HttpError(400, 'A completed discovery for this project is required');
    const rows = toProposalConsumerInventory(discovery.result.inventory as DomainInventory).rows;
    const selected = input.inventoryRowIds;
    if (
      Object.keys(input).some(
        (key) => !['discoveryRunId', 'inventoryRowIds', 'cron', 'variants'].includes(key),
      ) ||
      !Array.isArray(selected) ||
      !selected.length ||
      selected.length > 20 ||
      new Set(selected).size !== selected.length ||
      selected.some((id) => typeof id !== 'string' || !rows.some((row) => row.id === id))
    )
      throw new HttpError(
        400,
        'Campaign selection must contain 1–20 unique discovered source rows',
      );
    const variants = validateCampaignVariants(input.variants);
    if (input.cron !== undefined && typeof input.cron !== 'string')
      throw new HttpError(400, 'Campaign recurrence cron must be a string');
    const cron = input.cron as string | undefined;
    const nextFireAt = cron === undefined ? undefined : nextSlot(cron);
    if (cron !== undefined && !nextFireAt)
      throw new HttpError(400, 'Use a five-field cron expression in UTC');
    // Variant fan-out multiplies the whole-campaign capacity reservation.
    const slots = selected.length * (1 + variants.length);
    if (this.store.activeCount() + slots > 20)
      throw new HttpError(429, 'Insufficient queue capacity for the whole campaign');
    const project = this.store.project(projectId);
    if (!project?.execution)
      throw new HttpError(400, 'Campaigns require saved guided AI execution settings');
    // An anonymous state variant against an anonymous default persona would be a
    // duplicate of the default run — refuse instead of charging for a no-op.
    if (
      variants.some((variant) => variant.kind === 'state') &&
      project.execution.persona.mode === 'anonymous'
    )
      throw new HttpError(
        400,
        'An anonymous state variant is identical to this project\u2019s default persona',
      );
    const current = await sourceRevision(project.folder);
    const discovered = toProposalConsumerInventory(
      discovery.result.inventory as DomainInventory,
    ).source;
    if (
      current.dirty ||
      current.commit !== discovered.commit ||
      discovery.project.folder !== project.folder
    )
      throw new HttpError(409, 'Source changed since discovery; commit changes and discover again');
    const campaign: Campaign = {
      id: randomUUID(),
      projectId,
      projectName: project.name,
      discoveryRunId: discovery.id,
      sourceCommit: current.commit,
      createdAt: new Date().toISOString(),
      runIds: [],
      rows: campaignRows(discovery.result.inventory as DomainInventory),
      ...(variants.length ? { variants } : {}),
      ...(nextFireAt && cron ? { cron, nextFireAt } : {}),
    };
    this.store.db.transaction(() => {
      this.requireQueueCapacity(slots);
      if (JSON.stringify(this.store.project(projectId)) !== JSON.stringify(project))
        throw new HttpError(409, 'Project settings changed; review the campaign again');
      if (!this.store.run(discovery.id))
        throw new HttpError(409, 'Discovery was deleted; discover again');
      for (const inventoryRowId of selected as string[]) {
        // Default run first (exactly the pre-variants shape), then one run per
        // variant in declared order with variantKey set on the workflow scope.
        const row = campaign.rows.find((item) => item.inventoryRowId === inventoryRowId)!;
        const run = this.store.enqueue(project, 'agent')!;
        run.workflowScope = {
          campaignId: campaign.id,
          inventoryRowId,
          sourceCommit: current.commit,
        };
        this.store.saveRun(run);
        campaign.runIds.push(run.id);
        row.runId = run.id;
        for (const variant of variants) {
          const variantRun = this.store.enqueue(project, 'agent')!;
          variantRun.workflowScope = {
            campaignId: campaign.id,
            inventoryRowId,
            sourceCommit: current.commit,
            variantKey: variant.key,
            ...variantScopePayload(variant),
          };
          this.store.saveRun(variantRun);
          campaign.runIds.push(variantRun.id);
          row.runIds = [...(row.runIds ?? []), variantRun.id];
        }
      }
      this.store.saveCampaign(campaign);
      this.store.audit('campaign.queued', campaign.id);
    })();
    this.kick();
    return campaign;
  }
  private requireQueueCapacity(count: number) {
    if (this.closed || this.queueError)
      throw new HttpError(
        503,
        'Run queue is unavailable; restart the server after checking storage',
      );
    if (this.store.activeCount() + count > 20)
      throw new HttpError(429, 'Insufficient queue capacity for the whole campaign');
  }
  campaign(id: string) {
    const campaign = this.store.campaign(id);
    if (!campaign) throw new HttpError(404, 'Campaign not found');
    return campaignView(
      campaign,
      campaign.runIds.map((runId) => this.store.run(runId)),
      (inventoryRowId) => rowHistoryOf(this.store.rowRuns(campaign.projectId, inventoryRowId)),
    );
  }
  async cancelCampaign(id: string) {
    const campaign = this.campaign(id);
    if (!campaign.counts.pending) throw new HttpError(409, 'Campaign is already finished');
    let interrupt = false;
    this.store.db.transaction(() => {
      this.store.saveCampaign({
        ...this.store.campaign(id)!,
        cancelledAt: new Date().toISOString(),
      });
      for (const runId of campaign.runIds) {
        const run = this.store.run(runId);
        if (!run || !['queued', 'running'].includes(run.state)) continue;
        interrupt ||= run.state === 'running';
        this.store.saveRun({
          ...run,
          state: 'cancelled',
          finishedAt: new Date().toISOString(),
          result: { outcome: 'blocked', summary: 'Campaign cancelled by administrator' },
        });
      }
      this.store.audit('campaign.cancelled', id);
    })();
    if (interrupt && this.active) await stopProcess(this.active.child);
  }
  /**
   * Per-fire source-drift re-validation: every due recurring schedule is checked
   * against the real source BEFORE tick() fires it, so a drifted campaign (dirty
   * tree or HEAD moved vs the pinned sourceCommit) never fires doomed runs.
   * Phase (b): the standard drift outcome is a REBIND — the guard enqueues a
   * fresh real discovery and disarms the slot; when the discovery completes,
   * drain()'s completion hook remaps the campaign onto the new commit by
   * inventoryRowId identity. Stop (phase (a)) is the fallback when rebinding is
   * impossible right now: no execution settings, or the queue cannot take the
   * discovery. Fail-soft: an unreadable source is drift by definition; one bad
   * campaign never blocks the others or the tick.
   */
  async guardDueCampaigns(now = new Date()) {
    for (const campaign of this.store.campaigns()) {
      if (!campaign.cron || campaign.cancelledAt || !campaign.nextFireAt) continue;
      if (campaign.rebinding) continue; // a rebind discovery is already in flight
      if (new Date(campaign.nextFireAt) > now) continue;
      try {
        const project = this.store.project(campaign.projectId);
        if (!project) continue;
        const current = await sourceRevision(project.folder);
        if (current.dirty || current.commit !== campaign.sourceCommit)
          await this.startRebindOrStop(campaign, project);
      } catch {
        this.stopDriftedSchedules(campaign.projectId, campaign.sourceCommit);
      }
    }
  }

  /** Rebind-first drift handling; stopDriftedSchedules stays the honest fallback. */
  private async startRebindOrStop(campaign: Campaign, project: Project) {
    let discoveryRunId: string | undefined;
    if (project.execution) {
      try {
        discoveryRunId = this.enqueue(project.id, 'discovery').id;
      } catch {
        discoveryRunId = undefined;
      }
    }
    if (!discoveryRunId) {
      this.stopDriftedSchedules(campaign.projectId, campaign.sourceCommit);
      return;
    }
    this.store.db.transaction(() => {
      // The campaign id is unchanged; the slot is disarmed until the rebind lands.
      this.store.saveCampaign({ ...campaign, nextFireAt: null, rebinding: { discoveryRunId } });
      this.store.audit('campaign.rebind-started', campaign.id);
    })();
  }

  /**
   * Rebind completion, driven from drain() after each recorded run: a campaign
   * with a finished rebind discovery is remapped onto the new commit. Survivors
   * (selected inventoryRowIds still present in the fresh inventory) re-acquire
   * per-row executions and the cron slot re-arms; dropped selections are
   * audited per row. Stop is the fallback: failed discovery, unpinnable source,
   * or selection exhausted. Capacity follows queueCampaign's whole-campaign
   * rule — when the surviving rows cannot fit, the rebind stays pending and
   * retries on the next drain completion (never a partial remap).
   */
  private async processRebinds() {
    for (const campaign of this.store.campaigns()) {
      if (campaign.cancelledAt || !campaign.rebinding) continue;
      const discovery = this.store.run(campaign.rebinding.discoveryRunId);
      if (
        !discovery ||
        discovery.projectId !== campaign.projectId ||
        discovery.mode !== 'discovery'
      ) {
        this.stopRebind(campaign, 'campaign.rebind-failed');
        continue;
      }
      if (['queued', 'running'].includes(discovery.state)) continue;
      if (discovery.state !== 'completed' || !discovery.result?.inventory) {
        this.stopRebind(campaign, 'campaign.rebind-failed');
        continue;
      }
      await this.rebindCampaign(campaign, discovery);
    }
  }

  private async rebindCampaign(campaign: Campaign, discovery: Run) {
    const inventory = discovery.result?.inventory;
    const project = this.store.project(campaign.projectId);
    if (!inventory || !project?.execution) {
      this.stopRebind(campaign, 'campaign.rebind-failed');
      return;
    }
    let current: Awaited<ReturnType<typeof sourceRevision>>;
    try {
      current = await sourceRevision(project.folder);
    } catch {
      this.stopRebind(campaign, 'campaign.rebind-failed');
      return;
    }
    // A dirty tree cannot be pinned: firing on it would doom every run to the
    // drain()'s 409 backstop, so rebinding onto it is refused.
    if (current.dirty) {
      this.stopRebind(campaign, 'campaign.rebind-failed');
      return;
    }
    const selected = new Set(
      campaign.rows
        .filter((row) => row.inventoryRowId && row.runId)
        .map((row) => row.inventoryRowId!),
    );
    const rows = campaignRows(inventory as DomainInventory);
    const survivors = rows.filter((row) => row.inventoryRowId && selected.has(row.inventoryRowId));
    if (!survivors.length) {
      this.stopRebind(campaign, 'campaign.rebind-exhausted');
      return;
    }
    // Variant fan-out multiplies the remap's whole-campaign capacity reservation.
    if (this.store.activeCount() + survivors.length * (1 + (campaign.variants?.length ?? 0)) > 20)
      return; // deferred; retried on a later drain
    const nextFireAt = campaign.cron ? nextSlot(campaign.cron) : null;
    const survivorIds = new Set(survivors.map((row) => row.inventoryRowId!));
    this.store.db.transaction(() => {
      // Same identity, new source: rows come fresh from the NEW inventory and
      // only survivors carry runId (the fire path executes rows with a runId).
      const rebound: Campaign = {
        ...withoutRebinding(campaign),
        discoveryRunId: discovery.id,
        sourceCommit: current.commit,
        nextFireAt,
        runIds: [],
        rows,
        rebound: {
          survivors: survivors.length,
          dropped: selected.size - survivorIds.size,
          at: new Date().toISOString(),
        },
      };
      for (const row of survivors) {
        // Same fan-out shape as queueCampaign: default run first, then one run
        // per variant in declared order with variantKey set on the scope.
        const defaultRun = this.store.enqueue(project, 'agent')!;
        defaultRun.workflowScope = {
          campaignId: campaign.id,
          inventoryRowId: row.inventoryRowId!,
          sourceCommit: current.commit,
        };
        this.store.saveRun(defaultRun);
        rebound.runIds.push(defaultRun.id);
        rebound.rows.find((item) => item.inventoryRowId === row.inventoryRowId)!.runId =
          defaultRun.id;
        for (const variant of campaign.variants ?? []) {
          const variantRun = this.store.enqueue(project, 'agent')!;
          variantRun.workflowScope = {
            campaignId: campaign.id,
            inventoryRowId: row.inventoryRowId!,
            sourceCommit: current.commit,
            variantKey: variant.key,
            ...variantScopePayload(variant),
          };
          this.store.saveRun(variantRun);
          rebound.runIds.push(variantRun.id);
          const reboundRow = rebound.rows.find(
            (item) => item.inventoryRowId === row.inventoryRowId,
          )!;
          reboundRow.runIds = [...(reboundRow.runIds ?? []), variantRun.id];
        }
      }
      this.store.saveCampaign(rebound);
      this.store.audit('campaign.rebound', campaign.id);
      for (const id of selected)
        if (!survivorIds.has(id))
          this.store.audit('campaign.rebound-row-dropped', `${campaign.id}/${id}`);
    })();
  }

  /** Disarm a rebinding campaign for good; the schedule stops without firing again. */
  private stopRebind(campaign: Campaign, action: string) {
    this.store.db.transaction(() => {
      this.store.saveCampaign({ ...withoutRebinding(campaign), nextFireAt: null });
      this.store.audit(action, campaign.id);
    })();
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
      for (const source of this.store.campaigns()) {
        if (
          !source.cron ||
          source.cancelledAt ||
          !source.nextFireAt ||
          new Date(source.nextFireAt) > now
        )
          continue;
        const scheduledProject = this.store.project(source.projectId);
        if (
          !scheduledProject?.execution ||
          !this.store.run(source.discoveryRunId) ||
          !source.rows.some((row) => row.inventoryRowId)
        ) {
          this.store.saveCampaign({ ...source, nextFireAt: null });
          this.store.audit('campaign.schedule-stopped', source.id);
          continue;
        }
        // Recurring fires re-execute the campaign's selected rows only — unselected
        // discovery rows stay out of the slot's cost and queue capacity.
        const rows = source.rows.filter((row) => row.inventoryRowId && row.runId);
        // Deferred, not dropped: the slot stays due and retries on the next tick.
        // Variant fan-out multiplies the fire's whole-campaign capacity reservation.
        if (this.store.activeCount() + rows.length * (1 + (source.variants?.length ?? 0)) > 20)
          continue;
        const fired: Campaign = {
          id: randomUUID(),
          projectId: source.projectId,
          projectName: source.projectName,
          discoveryRunId: source.discoveryRunId,
          sourceCommit: source.sourceCommit,
          createdAt: now.toISOString(),
          runIds: [],
          // Strip BOTH ids: the spread would silently keep the source row's
          // stale runIds from the creation fan-out, corrupting per-fire attribution.
          rows: source.rows.map((row) => ({ ...row, runId: undefined, runIds: undefined })),
          // LOAD-BEARING: drain resolves a fired variant run's credentials via
          // store.campaign(run.workflowScope.campaignId) — the fired record must
          // carry the variants or every fired variant run would block as
          // unresolvable.
          ...(source.variants?.length ? { variants: source.variants } : {}),
        };
        for (const row of rows) {
          // Same fan-out shape as queueCampaign: default run first, then one run
          // per variant in declared order with variantKey set on the scope.
          const firedRow = fired.rows.find((item) => item.inventoryRowId === row.inventoryRowId)!;
          const defaultRun = this.store.enqueue(scheduledProject, 'agent')!;
          defaultRun.workflowScope = {
            campaignId: fired.id,
            inventoryRowId: row.inventoryRowId!,
            sourceCommit: source.sourceCommit,
          };
          this.store.saveRun(defaultRun);
          fired.runIds.push(defaultRun.id);
          firedRow.runId = defaultRun.id;
          for (const variant of source.variants ?? []) {
            const variantRun = this.store.enqueue(scheduledProject, 'agent')!;
            variantRun.workflowScope = {
              campaignId: fired.id,
              inventoryRowId: row.inventoryRowId!,
              sourceCommit: source.sourceCommit,
              variantKey: variant.key,
              ...variantScopePayload(variant),
            };
            this.store.saveRun(variantRun);
            fired.runIds.push(variantRun.id);
            firedRow.runIds = [...(firedRow.runIds ?? []), variantRun.id];
          }
        }
        this.store.saveCampaign({ ...source, nextFireAt: nextSlot(source.cron, now) });
        this.store.saveCampaign(fired);
        this.store.audit('campaign.scheduled', fired.id);
      }
    })();
    this.kick();
    if (
      now.getTime() >= this.nextRetentionAt &&
      !this.maintenance &&
      !this.runningId &&
      !this.store.activeCount() &&
      this.retention.state().policy.enabled
    ) {
      this.nextRetentionAt = now.getTime() + 60_000;
      void this.cleanupRetention().catch(() => {
        /* Retention keeps its own visible failure record. */
      });
    }
  }
  private kick() {
    if (this.pending || this.closed || this.maintenance) return;
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
    while (!this.closed && !this.maintenance && (run = this.store.next())) {
      this.runningId = run.id;
      this.store.saveRun({ ...run, state: 'running' });
      let result: RunResult;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await allowedFolder(run.project.folder, this.roots);
        if (run.workflowScope) {
          const current = await sourceRevision(run.project.folder);
          if (current.dirty || current.commit !== run.workflowScope.sourceCommit)
            throw new HttpError(409, sourceDriftRefusal);
        }
        const directory = join(this.directory, 'runs', run.id);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await mkdir(join(directory, '.model-images'), { recursive: true, mode: 0o700 });
        const input = join(directory, 'input.json');
        const output = join(directory, 'result.json');
        await writeFile(input, JSON.stringify(run), { mode: 0o600 });
        if (this.closed || this.store.run(run.id)?.state === 'cancelled')
          throw new Error('Run cancelled before launch');
        const overrides =
          run.mode === 'agent' && run.project.execution
            ? variantEnvironment(
                run,
                run.workflowScope ? this.store.campaign(run.workflowScope.campaignId) : undefined,
                run.project.execution,
                this.effectiveEnv(),
              )
            : run.mode === 'review'
              ? modelEnvironment(
                  run.visualReview!.modelConnection,
                  run.visualReview!.model,
                  run.visualReview!.modelSecretRef,
                  this.effectiveEnv(),
                )
              : run.mode === 'visual' && run.project.login
                ? loginEnvironment(run.project.login, this.effectiveEnv())
                : undefined;
        this.active = launchJob(input, output, overrides);
        timeout = setTimeout(
          () => {
            if (this.active) void stopProcess(this.active.child);
          },
          run.mode === 'agent'
            ? (run.project.execution?.maxRuntimeMinutes ?? 30) * 60_000
            : run.mode === 'visual'
              ? visualRuntimeLimit(run.project)
              : 5 * 60_000,
        );
        const code = await this.active.finished;
        if (code !== 0) throw new Error('Interrupted engine');
        result = JSON.parse(await readFile(output, 'utf8')) as RunResult;
        // Fraction of differing pixels an operator tolerates before a capture counts as changed.
        // 0 (the default) keeps the pixel-exact behavior: ratio > 0 ⇔ at least one pixel changed.
        const ratioGate = run.project.visualChangeRatio ?? 0;
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
              capture.environment?.deviceScaleFactor ?? 1,
            );
            Object.assign(capture, compared, {
              status: compared.ratio > ratioGate ? 'changed' : 'unchanged',
              baselineRunId: baseline.run_id,
              baselineFile: previous.file,
              diffFile,
              // Deterministic diff explanation: only from hash-verified current
              // assessment bytes; missing/unverifiable evidence leaves the
              // capture without an explanation rather than guessing.
              ...(await explainFromAssessment(directory, capture, compared.diffRegions)),
              // Whether the change is a layout shift, new content or paint —
              // from the two captures' own measured scenes, both hash-verified.
              ...(await classifyAgainstBaseline(
                (path) => readFile(path),
                digest,
                {
                  path: join(directory, capture.assessmentFile ?? ''),
                  sha256: capture.assessmentSha256,
                },
                {
                  path: join(
                    this.directory,
                    'runs',
                    baseline.run_id,
                    previous.assessmentFile ?? '',
                  ),
                  sha256: previous.assessmentSha256,
                },
                compared.diffRegions,
                capture.environment?.deviceScaleFactor ?? 1,
              )),
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
        await rm(join(this.directory, 'runs', run.id, '.model-images'), {
          recursive: true,
          force: true,
        });
      }
      if (this.store.run(run.id)?.state !== 'cancelled') this.store.finish(run, result);
      if (run.workflowScope && result.summary === sourceDriftRefusal)
        this.stopDriftedSchedules(run.projectId, run.workflowScope.sourceCommit);
      // Every recorded run is a rebind retry opportunity: the discovery that
      // completes a rebind, or a finished run that freed queue capacity.
      await this.processRebinds();
      this.runningId = null;
    }
  }
  /** A refused workflow-scope run proves the pinned discovery is stale: recurring schedules on that commit stop firing. */
  private stopDriftedSchedules(projectId: string, sourceCommit: string) {
    this.store.db.transaction(() => {
      for (const source of this.store.campaigns()) {
        if (!source.cron || source.cancelledAt || !source.nextFireAt) continue;
        if (source.projectId !== projectId || source.sourceCommit !== sourceCommit) continue;
        this.store.saveCampaign({ ...source, nextFireAt: null });
        this.store.audit('campaign.schedule-drift-stopped', source.id);
      }
    })();
  }
  async idle() {
    await this.pending;
    await this.mutationTail;
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
        this.store.approve(run.projectId, capture.specHash, runId, captureId, capture.sha256);
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
        ...(capture.videoFile ? [capture.videoFile] : []),
        ...(capture.assessmentFile ? [capture.assessmentFile] : []),
      ]),
    );
    if (run?.result?.captures?.length) {
      files.add('timeline.json');
      files.add('timeline.sanitization.json');
    }
    const checkpoint = run?.result?.workflowCaptures?.find(
      (item) => item.file === filename || item.privacyFile === filename,
    );
    if (checkpoint) {
      const bytes = await readWorkflowArtifact(
        join(this.directory, 'runs', runId, filename),
        checkpoint.file === filename ? checkpoint.sha256 : checkpoint.privacySha256,
      );
      return {
        bytes,
        type: checkpoint.file === filename ? 'image/png' : 'application/json; charset=utf-8',
      };
    }
    if (!files.has(filename)) throw new HttpError(404, 'Artifact not found');
    const path = join(this.directory, 'runs', runId, filename);
    const image = run?.result?.captures?.find((capture) => capture.file === filename);
    const assessment = run?.result?.captures?.find(
      (capture) => capture.assessmentFile === filename,
    );
    let bytes: Buffer;
    if (image || assessment) {
      const evidence = await readEvidenceFile(
        path,
        image ? image.sha256 : assessment!.assessmentSha256!,
        image ? 16 * 1024 * 1024 : 4 * 1024 * 1024,
      );
      if (!evidence.ok) throw new HttpError(409, 'Capture evidence integrity check failed');
      bytes = evidence.bytes;
    } else bytes = await readFile(path);
    return {
      bytes,
      type: filename.endsWith('.png')
        ? 'image/png'
        : filename.endsWith('.webm')
          ? 'video/webm'
          : 'application/json; charset=utf-8',
    };
  }
  async deleteRun(id: string) {
    return this.maintain(() => this.retention.deleteRun(id));
  }
  private maintain<T>(action: () => Promise<T>) {
    return this.mutate(async () => {
      if (this.closed) throw new HttpError(503, 'Workbench is closing');
      if (this.runningId || this.store.activeCount())
        throw new HttpError(409, 'Active runs must finish before evidence cleanup');
      this.maintenance = true;
      try {
        return await action();
      } finally {
        this.maintenance = false;
        this.kick();
      }
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
