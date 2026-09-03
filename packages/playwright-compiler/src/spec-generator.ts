import type { Workflow, WorkflowTransition } from '@arxic/contracts';

const SUBMIT_BUTTON_NAME =
  '/submit|log in|login|sign in|continue|send|change|reset|verify|confirm|enroll|register|sign up/i';

export class UnsupportedWorkflowStepError extends Error {
  readonly transition: WorkflowTransition;

  constructor(transition: WorkflowTransition, message: string) {
    super(message);
    this.name = 'UnsupportedWorkflowStepError';
    this.transition = transition;
  }
}

export function generateSpec(
  workflow: Workflow,
  origin: string,
  runtimeUrl?: string,
  options: {
    captureScreenshots?: boolean;
    /** Additive network origins permitted alongside the declared test base URL. */
    allowedOrigins?: readonly string[];
    /** Legacy complete approved-origin allowlist. */
    approvedOrigins?: string[];
  } = {},
): { spec: string; nonSemanticLocatorRationale?: string } {
  const captureScreenshots = options.captureScreenshots ?? true;
  const approvedOrigin = new URL(origin).origin;
  const approvedOrigins = [
    ...new Set(
      [...(options.approvedOrigins ?? [approvedOrigin]), ...(options.allowedOrigins ?? [])].map(
        (value) => new URL(value).origin,
      ),
    ),
  ];
  const requiredTransitions = workflow.transitions.filter((item) => item.required !== false);
  const lines = [
    "import { test, expect, assertNetworkContained, assertPageOrigin, configureApprovedOrigins, enforceNetworkContainment } from '../fixtures/workflow.fixture';",
    'import {',
    '  armReceiptCapture,',
    '  recordTransitionReceipt,',
    '  withReceiptAttribution,',
    "} from '../fixtures/transition-receipts';",
    ...(captureScreenshots
      ? ["import { capturePolicyScreenshot } from '../fixtures/screenshot-privacy';"]
      : []),
    '',
    '// #312 (F-E9): label-first with placeholder fallback — the #303',
    '// exploration-lane semantics. A control the page addresses only by',
    '// placeholder (the real directus login shape: zero <label> elements)',
    '// binds through the fallback; the unique-form fail-closed gate is',
    '// unchanged.',
    'function labelOrPlaceholderControl(root, text) {',
    '  return root.getByLabel(text).or(root.getByPlaceholder(text));',
    '}',
    '',
    `configureApprovedOrigins(${JSON.stringify(approvedOrigins)});`,
    '',
    `test(${JSON.stringify(workflow.id)}, async ({ page, context }) => {`,
  ];
  let usedFormScope = false;
  for (const [index, transition] of requiredTransitions.entries()) {
    const action = renderAction(transition);
    if (action.formScoped) usedFormScope = true;
    lines.push(
      `  await test.step(${JSON.stringify(`${transition.from} → ${transition.to}`)}, async () => {`,
      // #307/F-E8: arm ONCE, then attribute per request — each step's goto
      // opens a NAVIGATE window (only its DOCUMENT request gates); actions
      // ride enforceNetworkContainment's ACTION window in the fixture. The
      // app's own boot probes (directus /auth/refresh -> 400 + console error
      // on load, fired after the goto begins) are never attributed.
      ...(index === 0 ? ['    armReceiptCapture(page);'] : []),
      `    await withReceiptAttribution(page, 'navigate', () => page.goto(${JSON.stringify(index === 0 && runtimeUrl ? new URL(runtimeUrl, origin).href : new URL(statePath(transition.from), origin).href)}));`,
      '    assertPageOrigin(page);',
      '    assertNetworkContained(context);',
      ...action.lines,
      '    assertNetworkContained(context);',
      ...renderAssertions(transition, origin),
      ...(captureScreenshots
        ? [
            `    await capturePolicyScreenshot(page, ${JSON.stringify(`artifacts/screenshots/step-${index + 1}-${fileNamePart(transition.from)}-${fileNamePart(transition.to)}.png`)});`,
          ]
        : []),
      `    recordTransitionReceipt(page, ${JSON.stringify(transitionReceiptId(requiredTransitions, index))}, ${JSON.stringify(`${transition.from} → ${transition.to}`)});`,
      '  });',
    );
  }
  lines.push('});', '');
  return {
    spec: lines.join('\n'),
    ...(usedFormScope
      ? {
          nonSemanticLocatorRationale:
            "Submit-action inputs are scoped to their containing form via page.locator('form').filter so identically-labelled fields on a single multi-form page resolve unambiguously; controls bind label-first with a placeholder fallback (#312, the #303 exploration-lane semantics) and the submit binds by role within the form scope.",
        }
      : {}),
  };
}

export function transitionReceiptId(
  transitions: readonly WorkflowTransition[],
  index: number,
): string {
  const transition = transitions[index];
  if (!transition) throw new RangeError(`Transition index ${index} is out of range`);
  const base = `${transition.from}->${transition.to}`;
  const duplicates = transitions.filter((item) => `${item.from}->${item.to}` === base);
  if (duplicates.length === 1) return base;
  return `${base}#${duplicates.indexOf(transition) + 1}`;
}

export function generateControlStateSpec(
  workflow: Workflow,
  origin: string,
  transitionIndex: number,
  assertionIndex: number,
): { spec: string } {
  const approvedOrigin = new URL(origin).origin;
  const transition = workflow.transitions[transitionIndex];
  if (!transition) throw new RangeError(`Transition index ${transitionIndex} is out of range`);
  if (!transition.assertions[assertionIndex])
    throw new RangeError(`Assertion index ${assertionIndex} is out of range`);

  return {
    spec: [
      "import { test, expect, configureApprovedOrigins, enforceNetworkContainment } from '../fixtures/workflow.fixture';",
      '',
      `configureApprovedOrigins([${JSON.stringify(approvedOrigin)}]);`,
      '',
      `test(${JSON.stringify(`${workflow.id} control state ${transitionIndex}:${assertionIndex}`)}, async ({ page }) => {`,
      `  await enforceNetworkContainment(page, () => page.goto(${JSON.stringify(new URL(statePath(transition.from), origin).href)}));`,
      ...renderAssertions(transition, origin, assertionIndex),
      '});',
      '',
    ].join('\n'),
  };
}

function renderAction(transition: WorkflowTransition): {
  lines: string[];
  formScoped: boolean;
} {
  const inputRefs = Object.entries(transition.action.inputRefs ?? {});
  const intent = transition.action.intent.trim();
  // DG-09 generic form-flow executor: when the intent names the submit
  // control explicitly (`Submit <flow> via "<accessible name>"`), that
  // inventory-supplied name parameterizes the form filter and click instead of
  // the fixed auth submit-button list — domain-general by construction.
  const viaControl = intent.match(/^submit\s+.+?\s+via\s+"(.+)"$/iu);
  if (viaControl?.[1] && inputRefs.length > 0) {
    const controlName = JSON.stringify(viaControl[1]);
    const labels = inputRefs.map(([name]) => label(name));
    const formFilter = labels
      .map((value) => `.filter({ has: labelOrPlaceholderControl(page, ${JSON.stringify(value)}) })`)
      .join('');
    const submitButtonFilter = `.filter({ has: page.getByRole('button', { name: ${controlName}, exact: true }) })`;
    return {
      lines: [
        `    const form = page.locator('form')${formFilter}${submitButtonFilter};`,
        '    await expect(form).toHaveCount(1);',
        ...inputRefs.map(
          ([name, reference]) =>
            `    await labelOrPlaceholderControl(form, ${JSON.stringify(label(name))}).fill(process.env[${JSON.stringify(environmentName(reference))}] ?? '');`,
        ),
        `    await enforceNetworkContainment(page, () => form.getByRole('button', { name: ${controlName}, exact: true }).click());`,
      ],
      formScoped: true,
    };
  }
  if (/^(submit|log in|login|sign in)/iu.test(intent) && inputRefs.length > 0) {
    const labels = inputRefs.map(([name]) => label(name));
    const formFilter = labels
      .map((value) => `.filter({ has: labelOrPlaceholderControl(page, ${JSON.stringify(value)}) })`)
      .join('');
    const submitButtonFilter = `.filter({ has: page.getByRole('button', { name: ${SUBMIT_BUTTON_NAME} }) })`;
    return {
      lines: [
        `    const form = page.locator('form')${formFilter}${submitButtonFilter};`,
        '    await expect(form).toHaveCount(1);',
        ...inputRefs.map(
          ([name, reference]) =>
            `    await labelOrPlaceholderControl(form, ${JSON.stringify(label(name))}).fill(process.env[${JSON.stringify(environmentName(reference))}] ?? '');`,
        ),
        `    await enforceNetworkContainment(page, () => form.getByRole('button', { name: ${SUBMIT_BUTTON_NAME} }).click());`,
      ],
      formScoped: true,
    };
  }
  const open = intent.match(/^(?:open|go to|navigate to)\s+(.+)$/iu);
  if (open?.[1] && inputRefs.length === 0) {
    return {
      lines: [
        `    await enforceNetworkContainment(page, () => page.getByRole('link', { name: ${JSON.stringify(open[1])} }).click());`,
      ],
      formScoped: false,
    };
  }
  const click = intent.match(/^(?:click|select|choose)\s+(.+)$/iu);
  if (click?.[1] && inputRefs.length === 0) {
    return {
      lines: [
        `    await enforceNetworkContainment(page, () => page.getByRole('button', { name: ${JSON.stringify(click[1])} }).click());`,
      ],
      formScoped: false,
    };
  }
  throw new UnsupportedWorkflowStepError(
    transition,
    `Transition ${transition.from}→${transition.to} has no supported action pattern`,
  );
}

// #366: roles a role-qualified text assertion (`text@<role>:<text>`) may
// bind to. Deliberately tight — the observation lanes derive heading anchors
// only, so `heading` is the one role with derivation-side evidence. Anything
// else fails closed at compile instead of emitting a locator that can never
// resolve.
const TEXT_ASSERTION_ROLES: ReadonlySet<string> = new Set(['heading']);

function renderAssertions(
  transition: WorkflowTransition,
  origin: string,
  assertionIndex?: number,
): string[] {
  const assertions =
    assertionIndex === undefined ? transition.assertions : [transition.assertions[assertionIndex]!];
  return assertions.map((assertion) => {
    if (assertion.intent.startsWith('url:')) {
      const expected = assertion.intent.slice(4).trim();
      if (!expected) throw unsupportedAssertion(transition);
      const expectedUrl = new URL(expected, origin).href;
      const expectedRoute = new RegExp(`^${escapeRegExp(expectedUrl)}(?:[?#].*)?$`);
      return `    await expect(page).toHaveURL(${expectedRoute.toString()});`;
    }
    // #366: role-qualified text assertions scope the locator by the observed
    // role so pages where a heading and a control share the EXACT full text
    // (the real reference-auth-app /login: <h1>Login</h1> + <button>Login</button>)
    // resolve one element instead of strict-mode-violating on two.
    const roleQualified = /^text@([a-z]+):(.*)$/su.exec(assertion.intent);
    if (roleQualified) {
      const [, role, rawText] = roleQualified;
      const expected = rawText!.trim();
      // The role is allowlist-validated lowercase ([a-z]+), so it inlines
      // safely as a single-quoted literal — matching the generated spec's
      // other role-locator emissions.
      if (!expected || !TEXT_ASSERTION_ROLES.has(role!)) throw unsupportedAssertion(transition);
      return `    await expect(page.getByRole('${role}', { name: ${JSON.stringify(expected)}, exact: true })).toBeVisible();`;
    }
    if (assertion.intent.startsWith('text:')) {
      const expected = assertion.intent.slice(5).trim();
      if (!expected) throw unsupportedAssertion(transition);
      // Exact matching (#366): unscoped substring getByText resolves every
      // element CONTAINING the text — a render race then fails strict mode
      // (or passes spuriously against still-mounted pre-navigation DOM).
      return `    await expect(page.getByText(${JSON.stringify(expected)}, { exact: true })).toBeVisible();`;
    }
    throw unsupportedAssertion(transition);
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function unsupportedAssertion(transition: WorkflowTransition): UnsupportedWorkflowStepError {
  return new UnsupportedWorkflowStepError(
    transition,
    `Transition ${transition.from}→${transition.to} has an unsupported assertion`,
  );
}

function statePath(state: string): string {
  const normalized = state.replace(/-(?:page|form|state)$/u, '').replace(/^home$/u, '');
  return normalized ? `/${normalized}` : '/';
}

function label(name: string): string {
  const words = name.replace(
    /([a-z])([A-Z])/gu,
    (_match, lower: string, upper: string) => `${lower} ${upper.toLowerCase()}`,
  );
  return `${words.slice(0, 1).toUpperCase()}${words.slice(1)}`;
}

function fileNamePart(state: string): string {
  return state.replace(/[^A-Za-z0-9.-]+/gu, '-');
}

function environmentName(reference: string): string {
  return `ARXIC_INPUT_${reference.replace(/[^A-Za-z0-9]+/gu, '_').toUpperCase()}`;
}
