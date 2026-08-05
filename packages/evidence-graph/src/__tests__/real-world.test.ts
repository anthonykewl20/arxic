import { AstGrepAdapter } from '@arxic/ast-grep-adapter';
import { SourceUaAdapter } from '@arxic/source-ua-adapter';
import { describe, expect, it } from 'vitest';
import { buildStaticEvidenceGraph, ruleMatchNodeId, serializeCanonicalGraph } from '..';
import { makeRepository, packDirs } from './test-repo';

describe('real static inventory and evidence graph', () => {
  it.each([
    ['reference-auth-app', 'nextjs'],
    ['vulnerable-auth-app', 'express'],
  ] as const)(
    'connects the real %s /login route→handler→guard with real Tree-sitter and sg EvidenceRefs',
    async (fixture, framework) => {
      const repo = await makeRepository(fixture);
      const sourceAdapter = new SourceUaAdapter({ now: () => 'volatile-source-one' });
      const rulesAdapter = new AstGrepAdapter({
        packs: packDirs,
        now: () => 'volatile-rules-one',
      });
      const source = await sourceAdapter.collect(repo.request);
      const rules = await rulesAdapter.scan({
        revision: repo.revision,
        framework,
        features: ['login'],
      });
      const result = buildStaticEvidenceGraph({ source, rules });
      const chain = rules.chains.find(
        (candidate) => candidate.routePath === '/login' && candidate.status === 'connected',
      );
      expect(chain).toBeDefined();
      const matches = chain!.evidence.map((evidence) =>
        rules.matches.find(
          (match) =>
            match.evidence.ruleId === evidence.ruleId &&
            match.evidence.path === evidence.path &&
            match.evidence.startLine === evidence.startLine &&
            match.evidence.endLine === evidence.endLine,
        ),
      );
      const route = matches.find((match) => match?.category === 'route')!;
      const handler = matches.find((match) => match?.category === 'handler')!;
      const guard = matches.find((match) => match?.category === 'guard')!;
      const routeToHandler = `${ruleMatchNodeId(route)}->${ruleMatchNodeId(handler)}:handles`;
      const handlerToGuard = `${ruleMatchNodeId(handler)}->${ruleMatchNodeId(guard)}:guards`;
      expect(result.graph.hasEdge(routeToHandler)).toBe(true);
      expect(result.graph.hasEdge(handlerToGuard)).toBe(true);
      expect(result.graph.getEdgeAttribute(routeToHandler, 'kind')).toBe('handles');
      expect(result.graph.getEdgeAttribute(handlerToGuard, 'kind')).toBe('guards');
      for (const edge of [routeToHandler, handlerToGuard]) {
        const refs = result.graph.getEdgeAttribute(edge, 'evidenceRefs');
        expect(refs.length).toBeGreaterThanOrEqual(2);
        expect(
          refs.every(
            (evidence) =>
              evidence.kind === 'source' &&
              evidence.commit === repo.revision.commit &&
              evidence.blobSha256.length === 64,
          ),
        ).toBe(true);
      }
      expect(
        source.events.some(
          (event) =>
            'ref' in event && event.ref.kind === 'source' && event.ref.ruleId?.startsWith('route:'),
        ),
      ).toBe(true);

      const secondSource = await new SourceUaAdapter({ now: () => 'volatile-source-two' }).collect(
        repo.request,
      );
      const secondRules = await new AstGrepAdapter({
        packs: packDirs,
        now: () => 'volatile-rules-two',
      }).scan({ revision: repo.revision, framework, features: ['login'] });
      expect(serializeCanonicalGraph(result.graph)).toBe(
        serializeCanonicalGraph(
          buildStaticEvidenceGraph({ source: secondSource, rules: secondRules }).graph,
        ),
      );
    },
    120_000,
  );
});
