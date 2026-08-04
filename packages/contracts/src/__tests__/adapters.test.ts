import { describe, expect, it } from 'vitest';
import type {
  BundleManifest,
  BundlePromoter,
  Diagnostic,
  DiscoveryRequest,
  EvidenceEvent,
  EvidenceIndex,
  EvidenceRef,
  FixtureProvider,
  FixtureRequirement,
  GateResult,
  PlanResult,
  PromotionReceipt,
  RuntimeContext,
  SourceIndexer,
  SourceIndexRequest,
  SourceRevision,
  StagedBundle,
  SurfaceDiscoverer,
  VerificationPolicy,
  VerificationResult,
  Workflow,
  WorkflowCandidate,
  WorkflowCompiler,
  WorkflowPlanner,
  WorkflowVerifier,
} from '..';

const revision: SourceRevision = {
  repository: 'https://github.com/example/shop',
  commit: '0123456789abcdef0123456789abcdef01234567',
  dirty: false,
};

const evidenceRef: EvidenceRef = {
  kind: 'source',
  repo: revision.repository,
  commit: revision.commit,
  path: 'src/auth.ts',
  startLine: 1,
  endLine: 4,
  blobSha256: 'a'.repeat(64),
  extractor: 'contract-fake',
};

const diagnostic: Diagnostic = {
  code: 'ARXIC-ADAPTER-BOUNDARY',
  severity: 'blocked',
  subject: 'adapter',
  message: 'The boundary could not complete the operation.',
};

const workflow: Workflow = {
  $schema: 'https://arxic.dev/schemas/workflow/v1.json',
  id: 'auth.login.success',
  version: 1,
  title: 'Log in',
  domain: 'authentication',
  persona: 'registered-user',
  status: 'verified',
  confidence: 1,
  scope: {
    commit: revision.commit,
    environment: 'local-test',
    browser: 'chromium',
  },
  preconditions: [],
  states: [{ id: 'logged-out' }, { id: 'logged-in' }],
  transitions: [
    {
      from: 'logged-out',
      to: 'logged-in',
      action: { intent: 'Submit valid credentials' },
      assertions: [{ intent: 'The account home is visible' }],
      evidenceRefs: ['src:login-handler', 'run:login-success'],
    },
  ],
  negativeCases: [],
  verification: {
    requiredRuns: 2,
    screenshotCheckpoints: ['logged-in'],
    forbidNetworkErrors: true,
    trace: 'retain',
  },
  evidenceRefs: ['src:login-handler', 'run:login-success'],
};

const manifest: BundleManifest = {
  schemaVersion: 1,
  bundleVersion: 1,
  workflow: { id: workflow.id, status: workflow.status },
  repository: revision.repository,
  commit: revision.commit,
  appBuildDigest: 'b'.repeat(64),
  environment: { class: 'local-test', browser: 'chromium' },
  generator: { id: 'arxic', version: '0.0.0' },
  verification: {
    requiredRuns: 2,
    runs: [
      {
        startedAt: '2026-08-04T10:00:00.000Z',
        finishedAt: '2026-08-04T10:00:01.000Z',
        passed: true,
      },
      {
        startedAt: '2026-08-04T10:01:00.000Z',
        finishedAt: '2026-08-04T10:01:01.000Z',
        passed: true,
      },
    ],
  },
  fileHashes: [{ path: 'workflow.json', sha256: 'c'.repeat(64) }],
  gateResults: [{ gate: 'schema', passed: true }],
  coverage: { denominator: 1, verified: 1 },
  runId: 'run-auth-login',
};

const evidenceIndex: EvidenceIndex = { 'src:login-handler': evidenceRef };
const artifact = { kind: 'trace', path: 'artifacts/traces/run.zip', sha256: 'd'.repeat(64) };
const bundle: StagedBundle = {
  manifest,
  workflow,
  evidenceIndex,
  artifacts: [artifact],
  plan: '# Log in',
};

const collect = async (events: AsyncIterable<EvidenceEvent>) => {
  const collected: EvidenceEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
};

describe('ADR §10.5 adapter contracts', () => {
  it('adapters return contracts not upstream types; upstream engines stay behind the boundary (ADR §10.5)', async () => {
    const indexer: SourceIndexer = {
      async *index() {
        yield { ref: evidenceRef };
        yield { diagnostic };
      },
    };
    const discoverer: SurfaceDiscoverer = {
      async *discover() {
        yield { ref: evidenceRef };
      },
    };
    const fixtureProvider: FixtureProvider = {
      supports(requirement) {
        return requirement.kind === 'user';
      },
      async provision(requirement) {
        return { id: 'lease-user-1', requirement, expiresAt: '2026-08-04T11:00:00.000Z' };
      },
      async reset() {},
      async release() {},
    };
    const planner: WorkflowPlanner = {
      async plan() {
        return {
          intent: 'Log in as a registered user',
          steps: [{ intent: 'Submit valid credentials', actionClass: 'reversible-mutation' }],
          evidenceRefs: [evidenceRef],
        };
      },
    };
    const compiler: WorkflowCompiler = {
      async compile() {
        return bundle;
      },
    };
    const verifier: WorkflowVerifier = {
      async verify() {
        return {
          outcome: 'verified',
          diagnostics: [],
          artifacts: [artifact],
          runs: [{ passed: true }, { passed: true }],
        };
      },
    };
    const promoter: BundlePromoter = {
      async promote() {
        return {
          manifest,
          promotedAt: '2026-08-04T12:00:00.000Z',
          location: 'bundles/auth.login.success',
          checksumSha256: 'e'.repeat(64),
        };
      },
    };

    const sourceRequest: SourceIndexRequest = { revision, languages: ['typescript'] };
    const discoveryRequest: DiscoveryRequest = { origin: 'http://app.arxic.test', maxUrls: 10 };
    const requirement: FixtureRequirement = { kind: 'user', parameters: { role: 'member' } };
    const candidate: WorkflowCandidate = { workflow, neighborhood: [evidenceRef] };
    const context: RuntimeContext = {
      runId: manifest.runId,
      revision,
      environment: { class: 'local-test', origin: discoveryRequest.origin },
      persona: workflow.persona,
    };
    const policy: VerificationPolicy = {
      requiredRuns: 2,
      forbidNetworkErrors: true,
      trace: 'retain',
    };
    const gates: GateResult[] = [{ gate: 'execution', passed: true }];

    expect(await collect(indexer.index(sourceRequest))).toEqual([
      { ref: evidenceRef },
      { diagnostic },
    ]);
    expect(await collect(discoverer.discover(discoveryRequest))).toEqual([{ ref: evidenceRef }]);
    expect(fixtureProvider.supports(requirement)).toBe(true);
    const lease = await fixtureProvider.provision(requirement);
    expect(lease).toEqual({
      id: 'lease-user-1',
      requirement,
      expiresAt: '2026-08-04T11:00:00.000Z',
    });
    await expect(fixtureProvider.reset(lease)).resolves.toBeUndefined();
    await expect(fixtureProvider.release(lease)).resolves.toBeUndefined();
    const plan: PlanResult = await planner.plan(candidate, context);
    expect(plan.steps[0]).toEqual({
      intent: 'Submit valid credentials',
      actionClass: 'reversible-mutation',
    });
    expect(await compiler.compile(workflow, [evidenceRef])).toEqual(bundle);
    const verification: VerificationResult = await verifier.verify(bundle, policy);
    expect(['hypothesized', 'observed', 'verified', 'contradicted', 'blocked']).toContain(
      verification.outcome,
    );
    expect(verification.runs).toEqual([{ passed: true }, { passed: true }]);
    const receipt: PromotionReceipt = await promoter.promote(bundle, gates);
    expect(receipt.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.manifest).toBe(manifest);
  });

  it('adapters return structured results, never swallow errors as success (charter §1)', async () => {
    const verifier: WorkflowVerifier = {
      async verify() {
        return {
          outcome: 'blocked',
          diagnostics: [diagnostic],
          artifacts: [],
          runs: [{ passed: false }],
        };
      },
    };
    const result = await verifier.verify(bundle, {
      requiredRuns: 2,
      forbidNetworkErrors: true,
    });
    expect(result).toEqual({
      outcome: 'blocked',
      diagnostics: [diagnostic],
      artifacts: [],
      runs: [{ passed: false }],
    });
  });
});
