export type VisualEnvironment = {
  browser: 'chromium' | 'firefox' | 'webkit';
  colorScheme: 'light' | 'dark';
  /** Omitted in historical and 1x cells to preserve their baseline identity. */
  deviceScaleFactor?: 1 | 2 | 3;
  /** Explicit evidence identity for native Chromium captures; historical 1x uses the shell. */
  renderer?: 'chromium-full-headless';
};
export type RunMode = 'discovery' | 'visual' | 'agent' | 'review';
/** Form sign-in performed once per visual run; secrets are ARXIC_SECRET_ server variables. */
export type VisualLogin = {
  loginPath: string;
  emailRef: string;
  passwordRef: string;
  emailLabel: string;
  passwordLabel: string;
  submitLabel: string;
  /** Placeholder-only forms (e.g. koel) render no <label>; these non-secret
   * surface declarations are resolved against the live DOM after labels and
   * input types miss. */
  emailPlaceholder?: string;
  passwordPlaceholder?: string;
};
export type Project = {
  id: string;
  name: string;
  folder: string;
  origin: string;
  paths: string[];
  browsers?: VisualEnvironment['browser'][];
  colorSchemes?: VisualEnvironment['colorScheme'][];
  deviceScaleFactors?: Array<1 | 2 | 3>;
  viewports: Array<{ width: number; height: number }>;
  masks: string[];
  captureConsent: boolean;
  /** manual: only `paths`; discover: merge GET routes from the latest source discovery. */
  pageMode: 'manual' | 'discover';
  /** Record a WebM video of each capture session; privacy masks do not apply to video frames. */
  recordVideo: boolean;
  /** Crawl budget for AI discovery: pages captured and link depth followed from configured paths. */
  maxPages: number;
  maxDepth: number;
  /**
   * Fraction of pixels (0–0.5) allowed to differ from the baseline before a capture counts as
   * changed. 0 or unset keeps the pixel-exact behavior: any differing pixel flags the capture.
   * The diff image, changed pixels and regions stay recorded even for sub-threshold captures.
   */
  visualChangeRatio?: number;
  login?: VisualLogin;
  /**
   * Operator-declared state checkpoints (refs #402): how a route's
   * loading/error/empty/authenticated state is provoked (query parameters),
   * captured as first-class checkpoints with independent baselines.
   */
  stateCaptures?: Array<{
    path: string;
    state: string;
    query?: string;
    /**
     * Answer the page's own data requests with this status instead of letting
     * them through, so error banners and boundary fallbacks render. Document
     * navigation is untouched.
     */
    fault?: { status: number; path?: string };
    /** Submit the page's forms with empty fields to provoke inline validation. */
    submitEmptyForms?: boolean;
  }>;
  configPath: string;
  execution?: import('./execution').ExecutionSettings;
  cron: string;
  scheduleMode: RunMode;
  paused: boolean;
  nextRunAt: string | null;
  createdAt: string;
};
export type Capture = {
  environment?: VisualEnvironment;
  id: string;
  path: string;
  viewport: { width: number; height: number };
  file: string;
  sha256: string;
  specHash: string;
  browserVersion: string;
  status: 'needs-baseline' | 'unchanged' | 'changed' | 'unstable';
  changedPixels?: number;
  ratio?: number;
  baselineRunId?: string;
  baselineFile?: string;
  diffFile?: string;
  diffRegions?: Array<{ x: number; y: number; width: number; height: number }>;
  /** Deterministic fusion of the diff regions with measured scene elements and check verdicts. */
  diffExplanation?: import('./diff-explanation').DiffExplanation;
  videoFile?: string;
  authenticated?: boolean;
  /** Which declared state this checkpoint captures (e.g. 'error'); absent = the plain path. */
  stateVariant?: string;
  /**
   * Alerts, live regions and dialogs visible when an induced checkpoint was
   * captured. Geometry only — the text belongs to the target application.
   * Absent on a checkpoint that induced nothing.
   */
  transientRegions?: Array<{
    role: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  assessmentFile?: string;
  assessmentSha256?: string;
};
/** Immutable baseline approval record; `legacy` marks pointers predating the ledger. */
export type BaselineApprovalEntry =
  | {
      kind: 'approval';
      id: number;
      projectId: string;
      spec: string;
      runId: string;
      captureId: string;
      captureSha256: string;
      approvedAt: string;
      approvedBy: string;
      supersedes: number | null;
    }
  | {
      kind: 'legacy';
      projectId: string;
      spec: string;
      runId: string;
      captureId: string;
    };
export type RunResult = {
  visualEnvironments?: Array<
    VisualEnvironment & {
      outcome: 'observed' | 'blocked';
      captures: number;
      omittedPages?: number;
      reason?: string;
    }
  >;
  workflowCaptures?: import('./workflow-captures').WorkflowCapture[];
  workflowCaptureGap?: string;
  review?: import('./visual-review').VisualReviewResult;
  outcome: 'hypothesized' | 'observed' | 'verified' | 'contradicted' | 'blocked';
  summary: string;
  inventory?: unknown;
  workflowRows?: Campaign['rows'];
  frontend?: import('@arxic/source-ua-adapter').FrontendInventory;
  manifest?: unknown;
  diagnostics?: unknown;
  captures?: Capture[];
  /** Paths found by crawling the signed-in app during AI discovery, in discovery order. */
  discoveredPaths?: string[];
  /**
   * Runtime-rendered state markers (loading/error/empty, shared vocabulary with
   * the source tier) observed per discovered page route by plain navigation
   * during source discovery. Absence is never disproof: plain navigation
   * cannot provoke every conditional.
   */
  runtimeStates?: Array<{ path: string; states: string[] }>;
  /** Why runtime state observation was skipped (unconfigured/unreachable origin, failure). */
  runtimeObservationGap?: string;
  findings?: Array<{
    path: string;
    kind: string;
    count: number;
    environment?: VisualEnvironment;
    failurePhase?: CaptureFailurePhase;
    /** Observed engine-side error, one line; evidence for operators, never a claimed cause. */
    reason?: string;
  }>;
  ledger?: unknown;
  engineRun?: unknown;
};
export type Run = {
  id: string;
  projectId: string;
  mode: RunMode;
  state: 'queued' | 'running' | 'completed' | 'blocked' | 'cancelled';
  createdAt: string;
  finishedAt: string | null;
  project: Project;
  result: RunResult | null;
  visualReview?: import('./visual-review').VisualReviewScope;
  workflowScope?: {
    campaignId: string;
    inventoryRowId: string;
    sourceCommit: string;
    /** Set on variant fan-out runs; undefined means the campaign's default persona. */
    variantKey?: string;
    /** Non-secret flag overrides recorded on kind:'flag' variant fan-out runs. */
    variantFlags?: Record<string, boolean>;
    /** Persona-state override recorded on kind:'state' variant fan-out runs. */
    variantState?: 'anonymous';
    /** Non-secret login-surface override recorded on persona variant fan-out runs with a login declaration. */
    variantLogin?: {
      route: string;
      emailLabel?: string;
      passwordLabel?: string;
      submitLabel?: string;
    };
  };
};
export type Campaign = {
  id: string;
  projectId: string;
  projectName: string;
  discoveryRunId: string;
  sourceCommit: string;
  createdAt: string;
  cancelledAt?: string;
  /** Five-field UTC cron; when set, each slot re-executes the selected rows into a fresh campaign. */
  cron?: string;
  nextFireAt?: string | null;
  /**
   * Phase (b) drift rebind in flight: a fresh discovery is running and, on
   * completion, remaps this campaign onto the new commit by inventoryRowId
   * identity. While set, the schedule is disarmed (nextFireAt null) and never
   * fires; the campaign id itself is unchanged across the rebind.
   */
  rebinding?: { discoveryRunId: string };
  /**
   * Latest rebind outcome — survivors re-acquired per-row executions on the
   * new commit, dropped selections were audited per row; overwritten by any
   * later rebind; historical, survives until the campaign is deleted.
   */
  rebound?: { survivors: number; dropped: number; at: string };
  /**
   * Execution variants: each selected row fans out into one extra agent run per
   * variant. Persona variants carry ARXIC_SECRET_ ref NAMES (values never enter
   * this record); their optional login override is a NON-SECRET form declaration
   * (route + labels) that swaps the project login surface for that variant;
   * flag variants carry non-secret boolean overrides; state variants switch the
   * run to the anonymous persona.
   */
  variants?: Array<
    | {
        key: string;
        label: string;
        kind: 'persona';
        persona: { emailRef: string; passwordRef: string };
        login?: {
          route: string;
          emailLabel?: string;
          passwordLabel?: string;
          submitLabel?: string;
        };
      }
    | { key: string; label: string; kind: 'flag'; flags: Record<string, boolean> }
    | { key: string; label: string; kind: 'state'; state: 'anonymous' }
  >;
  runIds: string[];
  rows: Array<{
    key: string;
    method: string;
    path: string;
    disposition: string;
    reason: string;
    inventoryRowId?: string;
    /** The DEFAULT variant's run; `runIds` carries the per-variant run ids in declared order. */
    runId?: string;
    runIds?: string[];
  }>;
};

/** Last attempted capture operation; never inferred from raw exception text. */
export type CaptureFailurePhase =
  'environment' | 'navigation' | 'readiness' | 'measurement' | 'privacy-capture' | 'evidence-write';
