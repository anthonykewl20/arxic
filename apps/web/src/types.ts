export type VisualEnvironment = {
  browser: 'chromium' | 'firefox' | 'webkit';
  colorScheme: 'light' | 'dark';
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
};
export type Project = {
  id: string;
  name: string;
  folder: string;
  origin: string;
  paths: string[];
  browsers?: VisualEnvironment['browser'][];
  colorSchemes?: VisualEnvironment['colorScheme'][];
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
  login?: VisualLogin;
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
  videoFile?: string;
  authenticated?: boolean;
  assessmentFile?: string;
  assessmentSha256?: string;
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
  findings?: Array<{ path: string; kind: string; count: number; environment?: VisualEnvironment }>;
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
  workflowScope?: { campaignId: string; inventoryRowId: string; sourceCommit: string };
};
export type Campaign = {
  id: string;
  projectId: string;
  projectName: string;
  discoveryRunId: string;
  sourceCommit: string;
  createdAt: string;
  cancelledAt?: string;
  runIds: string[];
  rows: Array<{
    key: string;
    method: string;
    path: string;
    disposition: string;
    reason: string;
    inventoryRowId?: string;
    runId?: string;
  }>;
};
