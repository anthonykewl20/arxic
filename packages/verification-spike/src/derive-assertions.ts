// DG-03 observation-derived assertions (ADR-008 Decision 7). Post-action URL
// and DOM anchors captured from stage-8 runtime observation become assertion
// intents (`url:<path>`, `text:<heading>`); they are NOT acceptance oracles —
// provenance is attached at IntentSpec binding time (see intent-binding.ts).
import type { Diagnostic } from '@arxic/contracts';
import {
  ARXIC_DG03_DERIVATION_EMPTY,
  ARXIC_DG03_OBSERVATION_DRIFTED,
  dg03Diagnostic,
} from './diagnostics';

export type DerivedAssertion = Readonly<{
  kind: 'url' | 'text';
  intent: string;
  expectedValue: string;
}>;

const DEFAULT_MAX_TEXT_ASSERTIONS = 2;

export function deriveAssertionsFromObservation(
  observation: Readonly<{ url: string; headings?: readonly string[]; allowedOrigin?: string }>,
  options: Readonly<{ maxTextAssertions?: number }> = {},
):
  | { ok: true; assertions: readonly DerivedAssertion[] }
  | { ok: false; diagnostics: readonly Diagnostic[] } {
  const maxText = options.maxTextAssertions ?? DEFAULT_MAX_TEXT_ASSERTIONS;
  let parsed: URL;
  try {
    parsed = new URL(observation.url);
  } catch {
    return { ok: false, diagnostics: [derivationEmpty(observation.url)] };
  }
  if (!/^https?:$/u.test(parsed.protocol) || parsed.pathname === '') {
    return { ok: false, diagnostics: [derivationEmpty(observation.url)] };
  }
  if (observation.allowedOrigin !== undefined && parsed.origin !== observation.allowedOrigin) {
    return {
      ok: false,
      diagnostics: [
        dg03Diagnostic(
          ARXIC_DG03_OBSERVATION_DRIFTED,
          'blocked',
          'observation',
          `Observed URL ${parsed.origin} left the allowed origin ${observation.allowedOrigin}`,
        ),
      ],
    };
  }
  const assertions: DerivedAssertion[] = [
    { kind: 'url', intent: `url:${parsed.pathname}`, expectedValue: `url:${parsed.pathname}` },
  ];
  const seen = new Set<string>();
  for (const heading of observation.headings ?? []) {
    const trimmed = heading.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    if (seen.size >= maxText) break;
    seen.add(trimmed);
    assertions.push({ kind: 'text', intent: `text:${trimmed}`, expectedValue: `text:${trimmed}` });
  }
  if (assertions.length === 0) {
    return { ok: false, diagnostics: [derivationEmpty(observation.url)] };
  }
  return { ok: true, assertions };
}

function derivationEmpty(url: string): Diagnostic {
  return dg03Diagnostic(
    ARXIC_DG03_DERIVATION_EMPTY,
    'blocked',
    'observation',
    `No assertion could be derived from the observed URL: ${url || '(empty)'}`,
  );
}
