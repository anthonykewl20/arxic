/**
 * Engine vocabulary, in words a person can read.
 *
 * The dashboard used to print what the engine calls things: `needs-baseline`,
 * `hypothesized extracted`, `unlabeled-inputs`, `document-horizontal-overflow`.
 * Every one of those is precise and none of them is readable, and the operator
 * looking at a screenshot of their own sign-in page should not have to learn
 * the engine's ontology to find out whether it is broken.
 *
 * Each term gets three things: a plain `label` for the surface, a `detail`
 * sentence for when the label is not enough, and a `tone` so the label can
 * carry its own colour. The engine word itself is kept as `term` so it can be
 * shown on demand — nothing is hidden, it is just no longer first.
 *
 * One module, because the same words have to appear identically on the Pages
 * grid, in the Changes queue and on a run: an operator who learns "Looks
 * different" in one place must not meet "changed" in the next.
 */
export type Tone = 'ok' | 'attention' | 'problem' | 'unknown' | 'neutral';

export type Words = {
  /** What a person reads first. Sentence case, no jargon, no engine nouns. */
  label: string;
  /** One sentence of "detail on demand": what it means, or what to do. */
  detail: string;
  tone: Tone;
  /** The engine's own word, kept so precision is available rather than lost. */
  term: string;
};

/** How one capture compared against its approved picture. */
export function captureWords(status: string, changedPixels?: number): Words {
  switch (status) {
    case 'unchanged':
      return {
        label: 'Looks the same',
        detail: 'Every pixel matches the approved picture.',
        tone: 'ok',
        term: status,
      };
    case 'changed':
      return {
        label: 'Looks different',
        detail: changedPixels
          ? `${changedPixels.toLocaleString()} pixels differ from the approved picture. Someone needs to decide whether that is intended.`
          : 'This differs from the approved picture. Someone needs to decide whether that is intended.',
        tone: 'attention',
        term: status,
      };
    case 'needs-baseline':
      return {
        label: 'First look',
        detail:
          'There is no approved picture to compare against yet. Approve this one and later runs are measured against it.',
        tone: 'neutral',
        term: status,
      };
    case 'unstable':
      return {
        label: 'Would not settle',
        detail:
          'The page was still moving when the screenshot was due, so no comparison was made. Animation or late-loading content is the usual cause.',
        tone: 'problem',
        term: status,
      };
    default:
      return {
        label: 'Not compared',
        detail: 'No comparison was recorded for this screenshot.',
        tone: 'unknown',
        term: status,
      };
  }
}

/**
 * How much the engine is willing to say it knows.
 *
 * `verified` is deliberately never produced by a run — only a person can
 * decide that something is confirmed — so its label speaks in the operator's
 * voice, not the engine's.
 */
export function evidenceWords(outcome: string): Words {
  switch (outcome) {
    case 'hypothesized':
      return {
        label: 'Read from your code',
        detail:
          'Found by reading the source. Nothing has run it yet, so it may not exist at runtime.',
        tone: 'unknown',
        term: outcome,
      };
    case 'observed':
      return {
        label: 'Seen running',
        detail: 'Recorded while the page was actually open in a browser.',
        tone: 'ok',
        term: outcome,
      };
    case 'verified':
      return {
        label: 'Confirmed by a person',
        detail: 'Someone reviewed the evidence and accepted it. A run can never set this.',
        tone: 'ok',
        term: outcome,
      };
    case 'contradicted':
      return {
        label: 'Did not match',
        detail: 'What ran disagreed with what the code said would happen.',
        tone: 'problem',
        term: outcome,
      };
    case 'blocked':
      return {
        label: 'Could not run',
        detail: 'Something stopped this before it produced evidence.',
        tone: 'problem',
        term: outcome,
      };
    default:
      return { label: outcome, detail: '', tone: 'neutral', term: outcome };
  }
}

/** What each kind of run does, said as an outcome rather than a mechanism. */
export function runModeWords(mode: string): Words {
  switch (mode) {
    case 'discovery':
      return {
        label: 'Read the code',
        detail: 'Reads your source to list the pages, endpoints and workflows it can find.',
        tone: 'neutral',
        term: mode,
      };
    case 'visual':
      return {
        label: 'Screenshot test',
        detail:
          'Opens each page in real browsers, screenshots it and compares against the approved picture.',
        tone: 'neutral',
        term: mode,
      };
    case 'agent':
      return {
        label: 'AI walkthrough',
        detail: 'An AI agent works through a journey in a real browser and records what happened.',
        tone: 'neutral',
        term: mode,
      };
    case 'review':
      return {
        label: 'Second look',
        detail: 'Re-examines evidence that has already been captured.',
        tone: 'neutral',
        term: mode,
      };
    default:
      return { label: mode, detail: '', tone: 'neutral', term: mode };
  }
}

/**
 * A check, phrased as the thing that should be true.
 *
 * The engine records a finding only when something is wrong, so `passing`
 * gives the same check its healthy wording. That lets a page show what was
 * looked at and passed, not only what failed — an operator cannot tell a clean
 * page from an unchecked one otherwise.
 */
type CheckCopy = {
  good: string;
  bad: (count: number) => string;
  detail: (count: number) => string;
  /**
   * Tone when the check reports something. Defaults to `problem`; a few of
   * these are the engine working as designed (outside requests are blocked on
   * purpose) or a limit to raise rather than a defect to fix, and colouring
   * those red would make a healthy page look broken.
   */
  tone?: Tone;
};

const checks: Record<string, CheckCopy> = {
  'horizontal-overflow': {
    good: 'Nothing runs off the side of the screen',
    bad: () => 'Content runs off the side of the screen',
    detail: () =>
      'The page is wider than the window, so people have to scroll sideways to read it.',
  },
  'text-contrast': {
    good: 'Text is dark enough to read',
    bad: (count) => `${count} ${count === 1 ? 'piece' : 'pieces'} of text may be too faint`,
    detail: (count) =>
      `${count} ${count === 1 ? 'run' : 'runs'} of text sit too close in colour to what is behind them. People with low vision will struggle.`,
  },
  'broken-images': {
    good: 'Every image loaded',
    bad: (count) => `${count} ${count === 1 ? 'image' : 'images'} failed to load`,
    detail: () =>
      'The browser asked for the image and got nothing back, so a gap is shown instead.',
  },
  'undecodable-images': {
    good: 'Every image finished drawing',
    bad: (count) => `${count} ${count === 1 ? 'image' : 'images'} could not be drawn`,
    detail: () =>
      'The file arrived but the browser could not decode it — usually a corrupt or truncated image.',
  },
  'unlabeled-inputs': {
    good: 'Every field has a label',
    bad: (count) => `${count} ${count === 1 ? 'field has' : 'fields have'} no label`,
    detail: (count) =>
      `A screen reader announces ${count === 1 ? 'this field' : 'these fields'} as "edit text" with no clue what to type.`,
  },
  'script-errors': {
    good: 'No JavaScript errors',
    bad: (count) => `${count} JavaScript ${count === 1 ? 'error' : 'errors'}`,
    detail: () => 'Code on the page threw while it was loading. Part of the page may not work.',
  },
  'http-errors': {
    good: 'Every request succeeded',
    bad: (count) => `${count} ${count === 1 ? 'request' : 'requests'} failed`,
    detail: () => 'The page asked the server for something and got an error back.',
  },
  'blocked-network-requests': {
    good: 'Stayed on your own site',
    bad: (count) => `${count} outside ${count === 1 ? 'request was' : 'requests were'} blocked`,
    detail: () =>
      'The page tried to reach another origin. Arxic blocks those on purpose so a test never depends on somebody else’s server.',
    tone: 'neutral',
  },
  'redirected-to-login': {
    good: 'Reached the page',
    bad: () => 'Sent to the sign-in page instead',
    detail: () =>
      'This page needs a signed-in user. Add sign-in details for the project so Arxic can reach it.',
  },
  'login-secrets-missing': {
    good: 'Sign-in details are available',
    bad: () => 'Sign-in details are missing',
    detail: () => 'The project has a sign-in form configured but no stored email or password.',
  },
  'login-failed': {
    good: 'Signed in successfully',
    bad: () => 'Could not sign in',
    detail: () =>
      'The sign-in form was filled and submitted but the page stayed put. Check the stored details and the field labels.',
  },
  'state-induction-no-form': {
    good: 'Found a form to test',
    bad: () => 'No form to test on this page',
    detail: () => 'This page was asked to show its validation errors, but it has no form.',
  },
  'state-induction-no-validation': {
    good: 'Showed its validation errors',
    bad: () => 'Showed no validation errors',
    detail: () =>
      'The form was submitted empty and complained about nothing. Required fields may not be checked.',
  },
  'state-induction-no-request': {
    good: 'Asked the server for data',
    bad: () => 'Never asked the server for data',
    detail: () =>
      'The page was set up to receive a failing response, but it made no request to fail.',
  },
  'state-induction-no-surface': {
    good: 'Showed the failure',
    bad: () => 'Showed nothing when the request failed',
    detail: () =>
      'The server answered with an error and the page carried on as if nothing happened. People see stale or empty content with no explanation.',
  },
  'capture-budget-truncated-pages': {
    good: 'Every page fitted in the budget',
    bad: (count) => `${count} ${count === 1 ? 'page was' : 'pages were'} skipped`,
    detail: () => 'The run hit its page limit. Raise the limit in the project to cover the rest.',
    tone: 'attention',
  },
  'capture-blocked-check-target-and-privacy-masks': {
    good: 'The screenshot was taken',
    bad: () => 'The screenshot could not be taken',
    detail: () => 'Check that the site is running and that the privacy masks still match the page.',
  },
  'timeline-write-failed': {
    good: 'The action log was saved',
    bad: () => 'The action log could not be saved',
    detail: () => 'Screenshots survived, but the record of what was done to reach them did not.',
  },
  'administrator-project-setting': {
    good: 'Project settings applied',
    bad: () => 'A project setting changed what was captured',
    detail: () => 'An administrator setting narrowed or widened this run.',
    tone: 'neutral',
  },
};

/** Every check the engine can report, in the order a person would read them. */
export const checkKinds = Object.keys(checks);

export function checkWords(kind: string, count = 0, passing = false): Words {
  const copy = checks[kind];
  if (!copy)
    return {
      label: kind.replace(/-/gu, ' ').replace(/^./u, (c) => c.toUpperCase()),
      detail: '',
      tone: passing ? 'ok' : 'problem',
      term: kind,
    };
  return passing
    ? { label: copy.good, detail: '', tone: 'ok', term: kind }
    : {
        label: copy.bad(count),
        detail: copy.detail(count),
        tone: copy.tone ?? 'problem',
        term: kind,
      };
}

/** Screenshot dimensions, said the way a person describes their own browser. */
export function browserName(browser: string) {
  return { chromium: 'Chrome', firefox: 'Firefox', webkit: 'Safari' }[browser] ?? browser;
}
export function themeName(scheme: string) {
  return scheme === 'dark' ? 'Dark' : 'Light';
}
export function sizeName(width: number) {
  if (width <= 480) return 'Phone';
  if (width <= 900) return 'Tablet';
  return 'Desktop';
}
/**
 * What a state checkpoint is showing.
 *
 * The engine names these after the mechanism that provoked them; a person
 * wants to know what they are looking at.
 */
export function stateName(state: string | undefined) {
  if (!state) return 'Normal';
  return (
    {
      loading: 'While loading',
      error: 'When something fails',
      empty: 'With no data',
      authenticated: 'Signed in',
      anonymous: 'Signed out',
      validation: 'With invalid input',
    }[state] ?? state.replace(/-/gu, ' ').replace(/^./u, (c) => c.toUpperCase())
  );
}

/**
 * Which copy of a site a project points at.
 *
 * `risky` is the part that does work rather than decorate: a run opens pages
 * for real and, with state checkpoints or an AI walkthrough, submits real
 * forms. Against production that deserves a question first.
 */
export type ProjectEnvironmentWords = Words & { risky: boolean };

const environments: Record<string, ProjectEnvironmentWords> = {
  development: {
    label: 'Development',
    detail: 'A copy of the site you can break. Tests run without asking.',
    tone: 'neutral',
    term: 'development',
    risky: false,
  },
  staging: {
    label: 'Staging',
    detail: 'A shared pre-release copy. Real data is unlikely but not impossible.',
    tone: 'attention',
    term: 'staging',
    risky: false,
  },
  production: {
    label: 'Production',
    detail:
      'The site your customers use. Tests that fill in forms or let an AI click through it will act on real data.',
    tone: 'problem',
    term: 'production',
    risky: true,
  },
};

/** Reads an unset environment as development, which is what an unclassified project is treated as. */
export function environmentWords(value: string | undefined): ProjectEnvironmentWords {
  return environments[value ?? 'development'] ?? environments.development!;
}

export const projectEnvironments = Object.values(environments);

/**
 * Whether a run has to ask before it starts.
 *
 * A screenshot test only looks: it opens pages, measures and photographs them,
 * and asking about that every time would train people to click through the
 * question. An AI walkthrough clicks, types and submits; so does a state
 * checkpoint configured to submit forms with empty fields. Against the copy
 * customers use, those two act on real data, and that is the whole reason a
 * project carries an environment at all.
 */
export function runNeedsConfirmation(
  project: { environment?: string; stateCaptures?: Array<{ submitEmptyForms?: boolean }> },
  mode: string,
): boolean {
  if (!environmentWords(project.environment).risky) return false;
  if (mode === 'agent') return true;
  return (
    mode === 'visual' &&
    (project.stateCaptures ?? []).some((checkpoint) => checkpoint.submitEmptyForms === true)
  );
}
