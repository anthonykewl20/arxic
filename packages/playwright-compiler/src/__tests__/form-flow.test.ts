// DG-09 red-first unit tests: the generic form-flow executor builder. The
// builder is parameterized purely by inventory data (route, labelled fields,
// persona input refs, submit control, observed post-action state) — no domain
// literals, no app-specific code. It emits a Workflow that compiles through the
// UNCHANGED spec generator and compile-policy gates.
import { describe, expect, it } from 'vitest';
import { validateWorkflow } from '@arxic/contracts';
import { ARXIC_COMPILE_UNSUPPORTED_STEP } from '../diagnostics';
import { buildFormFlowWorkflow } from '../form-flow';

const observation = {
  url: 'http://127.0.0.1:39321/newsletter/thanks',
  headings: ['Subscribed'],
  runtimeEvidenceRef: 'run:observation-newsletter',
};

describe('buildFormFlowWorkflow (generic form-flow executor, inventory-parameterized)', () => {
  it('builds a schema-valid workflow from inventory data + observation', () => {
    const result = buildFormFlowWorkflow({
      identity: {
        id: 'marketing.newsletter.subscribe',
        title: 'Newsletter subscribe',
        domain: 'marketing',
        persona: 'visitor',
      },
      route: '/newsletter',
      fields: [{ label: 'Email', inputRef: 'visitor.email' }],
      submitControlName: 'Subscribe',
      observation,
      scope: { commit: 'a'.repeat(40), environment: 'local-test', browser: 'chromium' },
      sourceEvidence: {
        ref: 'src:newsletter-handler',
        path: 'app/newsletter/page.tsx',
        range: [10, 40],
      },
      personaFacts: [{ fixture: 'visitor.email-present' }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validateWorkflow(result.workflow).ok).toBe(true);
    const transition = result.workflow.transitions[0]!;
    // Generic executor shape: goto(route) → fill(fields) → submit → assert(observed).
    expect(transition.from).toBe('newsletter-page');
    expect(transition.to).toBe('newsletter-thanks-page');
    expect(transition.action.intent).toBe('Submit newsletter subscribe form via "Subscribe"');
    expect(transition.action.inputRefs).toEqual({ Email: 'visitor.email' });
    // Observation-bound assertions, not canned literals.
    expect(transition.assertions.map(({ intent }) => intent)).toEqual([
      'url:/newsletter/thanks',
      'text:Subscribed',
    ]);
    expect(transition.evidenceRefs).toContain('run:observation-newsletter');
    expect(transition.evidenceRefs).toContain('src:newsletter-handler');
  });

  it('derives the from-state and to-state from inventory + observation data, not domain knowledge', () => {
    const result = buildFormFlowWorkflow({
      identity: {
        id: 'support.contact.sendMessage',
        title: 'Contact support',
        domain: 'support',
        persona: 'visitor',
      },
      route: '/contact',
      fields: [
        { label: 'Email', inputRef: 'visitor.email' },
        { label: 'Message', inputRef: 'visitor.message' },
      ],
      submitControlName: 'Send',
      observation: {
        url: 'http://127.0.0.1:39321/contact/sent',
        headings: ['Message sent'],
        runtimeEvidenceRef: 'run:observation-contact',
      },
      scope: { commit: 'a'.repeat(40), environment: 'local-test', browser: 'chromium' },
      sourceEvidence: { ref: 'src:contact-handler', path: 'app/contact/page.tsx', range: [1, 20] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const transition = result.workflow.transitions[0]!;
    expect(transition.from).toBe('contact-page');
    expect(transition.to).toBe('contact-sent-page');
    expect(transition.action.inputRefs).toEqual({
      Email: 'visitor.email',
      Message: 'visitor.message',
    });
    expect(transition.assertions.map(({ intent }) => intent)).toEqual([
      'url:/contact/sent',
      'text:Message sent',
    ]);
  });

  it('blocks a form flow with zero fields (the executor requires at least one fill)', async () => {
    const result = buildFormFlowWorkflow({
      identity: {
        id: 'marketing.newsletter.subscribe',
        title: 'Newsletter subscribe',
        domain: 'marketing',
        persona: 'visitor',
      },
      route: '/newsletter',
      fields: [],
      submitControlName: 'Subscribe',
      observation,
      scope: { commit: 'a'.repeat(40), environment: 'local-test', browser: 'chromium' },
      sourceEvidence: {
        ref: 'src:newsletter-handler',
        path: 'app/newsletter/page.tsx',
        range: [1, 5],
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe(ARXIC_COMPILE_UNSUPPORTED_STEP);
      expect(result.diagnostics[0]?.severity).toBe('blocked');
    }
  });

  it('blocks when the observation cannot yield assertions', () => {
    const result = buildFormFlowWorkflow({
      identity: {
        id: 'marketing.newsletter.subscribe',
        title: 'Newsletter subscribe',
        domain: 'marketing',
        persona: 'visitor',
      },
      route: '/newsletter',
      fields: [{ label: 'Email', inputRef: 'visitor.email' }],
      submitControlName: 'Subscribe',
      observation: { url: 'about:blank', headings: [], runtimeEvidenceRef: 'run:x' },
      scope: { commit: 'a'.repeat(40), environment: 'local-test', browser: 'chromium' },
      sourceEvidence: {
        ref: 'src:newsletter-handler',
        path: 'app/newsletter/page.tsx',
        range: [1, 5],
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.severity).toBe('blocked');
    }
  });
});
