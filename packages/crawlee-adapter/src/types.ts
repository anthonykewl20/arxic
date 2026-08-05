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
};

export type SurfaceDiscovererOptions = {
  maxConcurrency?: number;
  maxRequestRetries?: number;
  navigationTimeoutSecs?: number;
  browserExecutablePath?: string;
  now?: () => string;
  runId?: () => string;
};
