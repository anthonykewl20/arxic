// DG-09 red-first unit tests: observation-derived assertions and their binding
// into Workflow IR (ADR-008 Decision 7). Derivation is migrated from the DG-03
// spike (extracted, not imported); provenance classification stays in
// @arxic/intent — this layer binds assertions + runtime evidence only.
import { describe, expect, it } from 'vitest';
import type { Workflow } from '@arxic/contracts';
import { validateWorkflow } from '@arxic/contracts';
import { ARXIC_COMPILE_DERIVATION_EMPTY, ARXIC_COMPILE_OBSERVATION_DRIFT } from '../diagnostics';
import {
  bindObservationAssertions,
  deriveAssertionsFromObservation,
} from '../observation-assertions';

function baseWorkflow(): Workflow {
  return {
    $schema: 'https://arxic.dev/schemas/workflow/v1.json',
    id: 'marketing.newsletter.subscribe',
    version: 1,
    title: 'Newsletter subscribe',
    domain: 'marketing',
    persona: 'visitor',
    status: 'observed',
    confidence: 1,
    scope: { commit: 'a'.repeat(40), environment: 'local-test', browser: 'chromium' },
    preconditions: [],
    states: [{ id: 'newsletter-page' }, { id: 'subscribed' }],
    transitions: [
      {
        from: 'newsletter-page',
        to: 'subscribed',
        action: {
          intent: 'Submit newsletter subscribe form',
          inputRefs: { email: 'visitor.email' },
        },
        assertions: [{ intent: 'url:/' }],
        evidenceRefs: ['src:newsletter-handler'],
      },
    ],
    negativeCases: [],
    verification: {
      requiredRuns: 2,
      forbidNetworkErrors: true,
      screenshotCheckpoints: ['subscribed'],
      trace: 'retain',
    },
    evidenceRefs: ['src:newsletter-handler'],
  };
}

describe('deriveAssertionsFromObservation (productionized DG-03 derivation)', () => {
  it('derives the path-only url: assertion plus capped text: heading anchors', () => {
    const result = deriveAssertionsFromObservation({
      url: 'http://127.0.0.1:39321/newsletter/thanks?ref=header#main',
      headings: ['Subscribed', 'Subscribed', 'Next steps', 'Extra'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assertions.map(({ intent }) => intent)).toEqual([
      'url:/newsletter/thanks',
      'text:Subscribed',
      'text:Next steps',
    ]);
  });

  it('blocks on an unusable observed URL (never invents an assertion)', () => {
    for (const url of ['about:blank', 'data:text/plain,hi', '']) {
      const result = deriveAssertionsFromObservation({ url });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics[0]?.code).toBe(ARXIC_COMPILE_DERIVATION_EMPTY);
        expect(result.diagnostics[0]?.severity).toBe('blocked');
      }
    }
  });

  it('blocks when the observed URL left the allowed origin (drift is not an assertion)', () => {
    const result = deriveAssertionsFromObservation({
      url: 'http://evil.example.test/dashboard',
      allowedOrigin: 'http://127.0.0.1:39321',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe(ARXIC_COMPILE_OBSERVATION_DRIFT);
      expect(result.diagnostics[0]?.severity).toBe('blocked');
    }
  });
});

describe('bindObservationAssertions (observation-bound Workflow)', () => {
  it('replaces canned transition assertions with derived ones and attaches the runtime evidence ref', () => {
    const result = bindObservationAssertions({
      workflow: baseWorkflow(),
      derived: [
        { kind: 'url', intent: 'url:/newsletter/thanks', expectedValue: 'url:/newsletter/thanks' },
        { kind: 'text', intent: 'text:Subscribed', expectedValue: 'text:Subscribed' },
      ],
      runtimeEvidenceRef: 'run:observation-newsletter',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const transition = result.workflow.transitions[0]!;
    expect(transition.assertions.map(({ intent }) => intent)).toEqual([
      'url:/newsletter/thanks',
      'text:Subscribed',
    ]);
    expect(transition.evidenceRefs).toContain('run:observation-newsletter');
    expect(transition.evidenceRefs).toContain('src:newsletter-handler');
    // The produced Workflow stays schema-valid for the unchanged compiler.
    expect(validateWorkflow(result.workflow).ok).toBe(true);
  });

  it('leaves optional transitions untouched and binds every required one', () => {
    const workflow = baseWorkflow();
    workflow.transitions.push({
      from: 'subscribed',
      to: 'newsletter-page',
      action: { intent: 'Open newsletter page', inputRefs: {} },
      assertions: [{ intent: 'text:optional-anchor' }],
      evidenceRefs: [],
      required: false,
    });
    const result = bindObservationAssertions({
      workflow,
      derived: [
        { kind: 'url', intent: 'url:/newsletter/thanks', expectedValue: 'url:/newsletter/thanks' },
      ],
      runtimeEvidenceRef: 'run:observation-newsletter',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workflow.transitions[0]!.assertions).toEqual([
      { intent: 'url:/newsletter/thanks' },
    ]);
    expect(result.workflow.transitions[1]!.assertions).toEqual([
      { intent: 'text:optional-anchor' },
    ]);
  });

  it('blocks when no assertions could be derived rather than emitting an assertion-less transition', () => {
    const result = bindObservationAssertions({
      workflow: baseWorkflow(),
      derived: [],
      runtimeEvidenceRef: 'run:observation-newsletter',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.severity).toBe('blocked');
    }
  });
});
