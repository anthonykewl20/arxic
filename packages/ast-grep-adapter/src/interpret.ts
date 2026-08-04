import type { Diagnostic, EvidenceRefSource } from '@arxic/contracts';
import { ARXIC_RULES_CHAIN_INCOMPLETE, rulesDiagnostic } from './diagnostics';
import type { RuleMatch } from './runner';

export type EvidencedRuleMatch = RuleMatch & { evidence: EvidenceRefSource };
export type FeatureChain = {
  feature: string;
  routePath: string;
  framework: string;
  status: 'connected' | 'incomplete';
  truthState: 'hypothesized';
  evidence: EvidenceRefSource[];
};

const unquote = (value: string) => value.replace(/^['"]|['"]$/gu, '');
const featureFromRoute = (route: string) => route.split('/').filter(Boolean).at(-1) ?? 'home';

export function interpretMatches(
  matches: EvidencedRuleMatch[],
  features?: string[],
): { chains: FeatureChain[]; diagnostics: Diagnostic[] } {
  const chains: FeatureChain[] = [];
  const diagnostics: Diagnostic[] = [];
  const expressRoutes = matches.filter(
    (match) => match.packId === 'express-auth' && match.category === 'route',
  );
  for (const route of expressRoutes) {
    const routePath = unquote(String(route.fields.PATH ?? ''));
    const feature = featureFromRoute(routePath);
    if (features && !features.includes(feature)) continue;
    const handler = matches.find(
      (match) =>
        match.packId === route.packId &&
        match.category === 'handler' &&
        match.file === route.file &&
        match.startLine === route.startLine &&
        match.endLine === route.endLine,
    );
    const guards = matches.filter(
      (match) =>
        match.packId === route.packId &&
        match.category === 'guard' &&
        match.file === route.file &&
        match.startLine >= route.startLine &&
        match.endLine <= route.endLine,
    );
    const guard = guards.find((match) => 'PASSWORD' in match.fields) ?? guards[0];
    addChain(chains, diagnostics, {
      feature,
      routePath,
      framework: 'express',
      route,
      handler,
      guards: guard ? [guard] : [],
    });
  }
  const nextRoutes = matches.filter(
    (match) => match.packId === 'nextjs-auth' && match.category === 'route',
  );
  for (const route of nextRoutes) {
    const match = route.file.match(/(?:^|\/)app\/(.+)\/(?:page\.tsx|route\.ts)$/u);
    if (!match) continue;
    const routePath = `/${match[1]}`;
    const feature = featureFromRoute(routePath);
    if (features && !features.includes(feature)) continue;
    const directory = route.file.slice(0, route.file.lastIndexOf('/'));
    const handler = matches.find(
      (candidate) =>
        candidate.packId === route.packId &&
        candidate.category === 'handler' &&
        candidate.file.startsWith(`${directory}/`),
    );
    const guards = handler
      ? matches.filter(
          (candidate) =>
            candidate.packId === route.packId &&
            candidate.category === 'guard' &&
            candidate.file === handler.file,
        )
      : [];
    addChain(chains, diagnostics, {
      feature,
      routePath,
      framework: 'nextjs',
      route,
      handler,
      guards,
    });
  }
  chains.sort(
    (a, b) => a.framework.localeCompare(b.framework) || a.routePath.localeCompare(b.routePath),
  );
  return { chains, diagnostics };
}

function addChain(
  chains: FeatureChain[],
  diagnostics: Diagnostic[],
  input: {
    feature: string;
    routePath: string;
    framework: string;
    route: EvidencedRuleMatch;
    handler?: EvidencedRuleMatch;
    guards: EvidencedRuleMatch[];
  },
) {
  if (input.handler && input.guards.length > 0) {
    chains.push({
      feature: input.feature,
      routePath: input.routePath,
      framework: input.framework,
      status: 'connected',
      truthState: 'hypothesized',
      evidence: [
        input.route.evidence,
        input.handler.evidence,
        ...input.guards.map((guard) => guard.evidence),
      ],
    });
    return;
  }
  chains.push({
    feature: input.feature,
    routePath: input.routePath,
    framework: input.framework,
    status: 'incomplete',
    truthState: 'hypothesized',
    evidence: [input.route.evidence],
  });
  diagnostics.push(
    rulesDiagnostic(
      ARXIC_RULES_CHAIN_INCOMPLETE,
      `${input.framework}:${input.routePath}`,
      `Route ${input.routePath} has no evidenced ${input.handler ? 'guard' : 'handler'}; feature is not claimed`,
      'hypothesized',
    ),
  );
}
