import type { Diagnostic, DiscoveryRequest, EvidenceRefRuntime } from '@arxic/contracts';

export type SurfaceControl = {
  tag: string;
  type: string;
  name?: string;
  label?: string;
  required: boolean;
};

export type SurfaceForm = {
  action: string;
  method: string;
  destructive: boolean;
  controls: SurfaceControl[];
};

export type SurfaceLink = {
  href: string;
  text: string;
  external: boolean;
};

export type RouteSurface = {
  truthState: 'observed';
  url: string;
  path: string;
  depth: number;
  title: string;
  forms: SurfaceForm[];
  controls: SurfaceControl[];
  links: SurfaceLink[];
  evidence?: EvidenceRefRuntime;
};

export type NavigationEdge = {
  from: string;
  to: string;
  depth: number;
  status: 'observed' | 'blocked';
  reason?: 'external-origin' | 'max-depth' | 'max-urls';
};

export type SurfaceMap = {
  schemaVersion: 1;
  truthState: 'observed';
  origin: string;
  routes: RouteSurface[];
  navigationEdges: NavigationEdge[];
  diagnostics: Diagnostic[];
};

export type SurfaceDiscoveryRequest = DiscoveryRequest & {
  /** Explicit attested build digest. Otherwise the adapter reads the target attestation. */
  appBuildDigest?: string;
  /**
   * DG-289 C-4 (#289): additional origins whose ASSETS the crawl origin gate
   * admits alongside the target origin (config `target.allowedOrigins`).
   * Fail-closed default when unset/empty: target origin only. Crawl
   * following and link classification remain same-origin.
   */
  allowedOrigins?: readonly string[];
  /**
   * DG-297 E2 (#297): authenticate through the target's OWN login form (the
   * #288 declaration, #295 label-first/placeholder resolution) before breadth
   * discovery, seeding the crawl browser context with the captured storage
   * state. Unset → the crawl is anonymous (byte-identical to prior behavior).
   * A refused login emits ARXIC-SURFACE-009 (blocked) and the crawl proceeds
   * anonymously — never a fabricated authenticated surface. Credentials ride
   * in-memory only; they never appear in artifacts, diagnostics, or logs.
   */
  replayPersona?: {
    declaration: import('@arxic/verifier').ReplayPersonaDeclaration;
    persona: { email: string; password: string };
  };
};

export type SurfaceDiscovererOptions = {
  maxConcurrency?: number;
  maxRequestRetries?: number;
  navigationTimeoutSecs?: number;
  /** DG-297 E1 (#297): bounded per-URL wait for a form to attach (hydration settle); default 2500ms, 0 disables. */
  hydrationSettleMs?: number;
  browserExecutablePath?: string;
  now?: () => string;
  runId?: () => string;
};
