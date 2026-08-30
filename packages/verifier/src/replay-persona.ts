import type { Diagnostic } from '@arxic/contracts';
import { chromium, type Page } from '@playwright/test';
import {
  ARXIC_VERIFY_FIXTURE_DECLARATION_INVALID,
  ARXIC_VERIFY_FIXTURE_LOGIN_BLOCKED,
  ARXIC_VERIFY_FIXTURE_NOT_DECLARED,
  ARXIC_VERIFY_FIXTURE_PROD_REFUSED,
  verifyDiagnostic,
} from './diagnostics';
import type { VerificationPersona } from './reset';

/**
 * #288 — the frozen `fixtures.replayPersona` declaration (closed at freeze;
 * changes require an approved CONTRACT CHANGE REQUEST).
 *
 * The declaration carries ONLY locator metadata: the target's login route,
 * ordered labelled fields, and the submit control. Persona VALUES never
 * appear here — they come exclusively from the `ARXIC_INPUT_PERSONA_*` env
 * channel, exactly as the first-party fixture protocol already uses them.
 */
export type ReplayPersonaDeclaration = Readonly<{
  /** Closed enum at freeze: `per-pass-login` is the only value. */
  mode: 'per-pass-login';
  login: Readonly<{
    /** Login route on the target origin (path beginning with `/`). */
    route: string;
    /** Ordered labelled fields; `inputRef` is the closed persona-env set. */
    fields: readonly { readonly label: string; readonly inputRef: PersonaInputRef }[];
    /** The submit control (labelled button) of the target's login form. */
    submit: Readonly<{ label: string }>;
  }>;
}>;

/** Closed `inputRef` set at freeze (local-executor persona env naming). */
export type PersonaInputRef = 'persona.email' | 'persona.password' | 'persona.newpassword';

/** Maps a frozen `inputRef` to its persona value; `undefined` = not supplied. */
export type PersonaValueLookup = (inputRef: PersonaInputRef) => string | undefined;

const PERSONA_INPUT_REFS: readonly PersonaInputRef[] = [
  'persona.email',
  'persona.password',
  'persona.newpassword',
];

export function isPersonaInputRef(value: unknown): value is PersonaInputRef {
  return typeof value === 'string' && (PERSONA_INPUT_REFS as readonly string[]).includes(value);
}

/** The persona value for an `inputRef`, from the verifier's persona shape. */
export function personaValueLookup(persona: VerificationPersona): PersonaValueLookup {
  return (inputRef) => {
    switch (inputRef) {
      case 'persona.email':
        return persona.email;
      case 'persona.password':
        return persona.password;
      case 'persona.newpassword':
        return persona.newPassword;
    }
  };
}

/** The env-var name an `inputRef` replays from (verifier persona env naming). */
export function personaInputEnvName(inputRef: PersonaInputRef): string {
  return `ARXIC_INPUT_PERSONA_${inputRef.replace(/^persona\./u, '').toUpperCase()}`;
}

export const REPLAY_PERSONA_MODES = ['per-pass-login'] as const;

/** Frozen declaration key vocabulary (#288) — exported so pipeline code (CLI)
 *  references the frozen names without embedding domain literals in its own
 *  source (ADR-008 Decision 3 CLI gate). */
export const REPLAY_PERSONA_DECLARATION_KEYS = ['mode', 'login'] as const;

/**
 * Config-time validation of the declaration shape (C-5 / SP-4): emits
 * `ARXIC-VERIFY-FIXTURE-DECLARATION-INVALID` diagnostics at
 * `config.fixtures.replayPersona.*` for every violation — no silent defaults.
 */
export function validateReplayPersonaDeclaration(
  value: unknown,
): { ok: true; value: ReplayPersonaDeclaration } | { ok: false; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const invalid = (subject: string, detail: string) => {
    diagnostics.push(
      verifyDiagnostic(
        ARXIC_VERIFY_FIXTURE_DECLARATION_INVALID,
        'blocked',
        subject,
        `${subject} ${detail}`,
      ),
    );
  };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid('config.fixtures.replayPersona', 'must be an object');
    return { ok: false, diagnostics };
  }
  const declaration = value as Record<string, unknown>;
  if (
    typeof declaration.mode !== 'string' ||
    !(REPLAY_PERSONA_MODES as readonly string[]).includes(declaration.mode)
  ) {
    invalid('config.fixtures.replayPersona.mode', 'must be one of: per-pass-login (closed enum)');
  }
  const login = declaration.login;
  if (typeof login !== 'object' || login === null || Array.isArray(login)) {
    invalid('config.fixtures.replayPersona.login', 'must be an object');
    return { ok: false, diagnostics };
  }
  const loginRecord = login as Record<string, unknown>;
  if (
    typeof loginRecord.route !== 'string' ||
    !loginRecord.route.startsWith('/') ||
    new URL(`http://fixture.invalid${loginRecord.route}`).pathname !== loginRecord.route
  ) {
    invalid(
      'config.fixtures.replayPersona.login.route',
      'must be an absolute path on the target origin',
    );
  }
  const fields = loginRecord.fields;
  if (!Array.isArray(fields) || fields.length === 0) {
    invalid(
      'config.fixtures.replayPersona.login.fields',
      'must be a non-empty ordered array of { label, inputRef }',
    );
  } else if (
    fields.some((field: unknown) => {
      if (typeof field !== 'object' || field === null || Array.isArray(field)) return true;
      const record = field as Record<string, unknown>;
      return (
        typeof record.label !== 'string' ||
        record.label.trim().length === 0 ||
        !isPersonaInputRef(record.inputRef)
      );
    })
  ) {
    invalid(
      'config.fixtures.replayPersona.login.fields',
      'every field needs a non-empty label and an inputRef from: persona.email, persona.password, persona.newpassword',
    );
  }
  const submit = loginRecord.submit;
  if (
    typeof submit !== 'object' ||
    submit === null ||
    Array.isArray(submit) ||
    typeof (submit as Record<string, unknown>).label !== 'string' ||
    ((submit as Record<string, unknown>).label as string).trim().length === 0
  ) {
    invalid(
      'config.fixtures.replayPersona.login.submit',
      'must be an object with a non-empty label',
    );
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return { ok: true, value: declaration as unknown as ReplayPersonaDeclaration };
}

/**
 * Config-time refusal for a production-shaped target carrying the
 * declaration (C-3 / SP-2). Emitted alongside the CLI's default production
 * refusal — this one names the replay-persona path specifically.
 */
export function replayPersonaProductionRefusal(subject: string): Diagnostic {
  return verifyDiagnostic(
    ARXIC_VERIFY_FIXTURE_PROD_REFUSED,
    'blocked',
    subject,
    'fixtures.replayPersona is refused for production-shaped targets; replay-persona provisioning never runs against production',
  );
}

/**
 * Fail-closed refusal when an endpoint-less target is used without a
 * declaration (C-2 / SP-1) — verification refuses before any pass executes.
 */
export function replayPersonaNotDeclaredRefusal(subject: string): Diagnostic {
  return verifyDiagnostic(
    ARXIC_VERIFY_FIXTURE_NOT_DECLARED,
    'blocked',
    subject,
    'The target implements no arxic fixture endpoints and no fixtures.replayPersona declaration exists; verification refuses fail-closed',
  );
}

export class ReplayPersonaLoginError extends Error {
  constructor(
    message: string,
    readonly diagnostic: Diagnostic,
  ) {
    super(message);
    this.name = 'ReplayPersonaLoginError';
  }
}

/**
 * C-1: provision + log in the persona for ONE verification pass, in a FRESH
 * browser context (the per-pass login IS the leased mutation; lease = one
 * pass; no cross-pass state). Real Chromium through the same labelled-field
 * semantic locator grammar the exploration form-drive plan executes.
 *
 * Any failure throws {@link ReplayPersonaLoginError} carrying the frozen
 * `ARXIC-VERIFY-FIXTURE-LOGIN-BLOCKED` diagnostic — the pass classifies
 * `blocked`, never a partial or fabricated run.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** #297 E2: the authenticated browser storage state (cookies + origins) captured after a replay-persona login. */
export type ReplayPersonaStorageState = Readonly<{
  cookies: ReadonlyArray<Readonly<{ name: string; value: string; domain: string; path: string }>>;
  origins: ReadonlyArray<
    Readonly<{ origin: string; localStorage: ReadonlyArray<{ name: string; value: string }> }>
  >;
}>;

type ReplayLoginResult<TLoginSurface> = Readonly<{
  storageState?: ReplayPersonaStorageState;
  loginSurface?: TLoginSurface;
}>;

/**
 * #297 E2: perform the SAME per-pass replay-persona login, but return the
 * authenticated storage state instead of discarding it — the crawl tier's
 * authenticated-discovery bridge. Same diagnostics, same redaction, same
 * LOGIN-BLOCKED classification on failure.
 */
export async function replayPersonaStorageState<TLoginSurface = unknown>(options: {
  origin: string;
  declaration: ReplayPersonaDeclaration;
  persona: VerificationPersona;
  subject: string;
  timeoutMs?: number;
  /**
   * Optional structural observation of the uniquely scoped login form. It
   * runs before any persona value is filled, so callers can capture labels,
   * types, and submit semantics without a credential-bearing DOM snapshot.
   */
  captureLoginSurface?: (page: Page) => Promise<TLoginSurface>;
}): Promise<ReplayPersonaStorageState & Readonly<{ loginSurface?: TLoginSurface }>> {
  const result = await runReplayLogin(options, true);
  if (result.storageState === undefined)
    throw replayLoginError(
      options.subject,
      'The replay-persona login capture failed to produce a storage state',
    );
  return {
    ...result.storageState,
    ...(result.loginSurface === undefined ? {} : { loginSurface: result.loginSurface }),
  };
}

export async function loginReplayPersona(options: {
  origin: string;
  declaration: ReplayPersonaDeclaration;
  persona: VerificationPersona;
  subject: string;
  timeoutMs?: number;
}): Promise<void> {
  await runReplayLogin(options, false);
}

async function runReplayLogin<TLoginSurface>(
  options: {
    origin: string;
    declaration: ReplayPersonaDeclaration;
    persona: VerificationPersona;
    subject: string;
    timeoutMs?: number;
    captureLoginSurface?: (page: Page) => Promise<TLoginSurface>;
  },
  captureStorageState: boolean,
): Promise<ReplayLoginResult<TLoginSurface>> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const { declaration, persona, subject } = options;
  const valueFor = personaValueLookup(persona);
  const missing = declaration.login.fields
    .map((field) => ({ field, value: valueFor(field.inputRef) }))
    .filter((entry) => entry.value === undefined || entry.value.length === 0);
  if (missing.length > 0) {
    throw replayLoginError(
      subject,
      `No persona value is configured for declared login fields: ${missing
        .map(({ field }) => field.label)
        .join(', ')}`,
    );
  }
  let browser;
  let captured: ReplayPersonaStorageState | undefined;
  let loginSurface: TLoginSurface | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(new URL(declaration.login.route, options.origin).href, {
        waitUntil: 'load',
        timeout: timeoutMs,
      });
      // #295: SPA targets (directus) render their login form only AFTER
      // hydration, which commits after the load event. Wait for the declared
      // submit control to attach (label-first, then text) before scoping the
      // form — bounded by the same timeout, so a target that never renders
      // still classifies LOGIN-BLOCKED rather than racing.
      {
        const roleSubmit = page.getByRole('button', {
          name: declaration.login.submit.label,
          exact: true,
        });
        const textSubmit = page.locator('button', {
          hasText: new RegExp(`^${escapeRegExp(declaration.login.submit.label)}$`, 'u'),
        });
        try {
          await roleSubmit.first().waitFor({ state: 'attached', timeout: timeoutMs });
        } catch {
          await textSubmit.first().waitFor({ state: 'attached', timeout: timeoutMs });
        }
      }
      // #295: field addressing is LABEL-FIRST with a placeholder fallback —
      // vanilla SPA targets (directus, koel) ship placeholder-only inputs
      // with no <label>/aria-label, so label semantics alone resolve nothing
      // there. The declared string is matched against the label first; only
      // when label matching resolves zero elements does the placeholder
      // resolver run (same string, same diagnostics, same redaction).
      const resolveFieldLocator = (label: string) => {
        const byLabel = page.getByLabel(label, { exact: true });
        return {
          locator: byLabel,
          alternative: () => page.getByPlaceholder(label, { exact: true }),
        };
      };
      const first = resolveFieldLocator(declaration.login.fields[0]!.label);
      const firstCount = await first.locator.count();
      const firstField =
        firstCount > 0
          ? first.locator
          : (await first.alternative().count()) > 0
            ? first.alternative()
            : first.locator;
      // #295 (koel shape): a submit button wrapped in <label> loses its
      // accessible name in Chromium (label→button association is invalid),
      // so role-name matching alone cannot address it. Resolve the submit by
      // role-name first, then fall back to a button whose TEXT is the
      // declared label — same string, same click, same semantics.
      const submitByRole = page.getByRole('button', {
        name: declaration.login.submit.label,
        exact: true,
      });
      const submitLocator =
        (await submitByRole.count()) > 0
          ? submitByRole
          : page.locator('button', {
              hasText: new RegExp(`^${escapeRegExp(declaration.login.submit.label)}$`, 'u'),
            });
      const form = page
        .locator('form')
        .filter({ has: firstField.first() })
        .filter({ has: submitLocator.first() });
      if ((await form.count()) !== 1) {
        throw replayLoginError(
          subject,
          'The declared login form was not uniquely found on the login route (semantic form scoping failed)',
        );
      }
      // The form has been uniquely scoped by the same semantic locators that
      // drive it. Let callers retain a structural surface BEFORE filling so
      // persona values cannot enter their capture by this capability's flow.
      loginSurface = await options.captureLoginSurface?.(page);
      for (const field of declaration.login.fields) {
        const resolver = resolveFieldLocator(field.label);
        const byLabel = resolver.locator;
        const target =
          (await byLabel.count()) > 0
            ? byLabel
            : (await resolver.alternative().count()) > 0
              ? resolver.alternative()
              : byLabel;
        await target.first().fill(valueFor(field.inputRef)!, {
          timeout: timeoutMs,
        });
      }
      const submitByText = form.locator('button', {
        hasText: new RegExp(`^${escapeRegExp(declaration.login.submit.label)}$`, 'u'),
      });
      const submitClickable =
        (await submitByText
          .first()
          .isVisible()
          .catch(() => false)) && (await submitByText.count()) > 0
          ? submitByText.first()
          : form.getByRole('button', { name: declaration.login.submit.label, exact: true }).first();
      await submitClickable.click({
        timeout: timeoutMs,
      });
      // Deterministically wait for the submit to commit AWAY from the login
      // route (waitForLoadState alone can resolve on the pre-submit document
      // while the POST is still in flight). #295: hash-router SPAs (koel)
      // keep the SAME pathname and move only the fragment (#/home), and
      // fetch-based submits change no URL at all — so success is: the
      // pathname left the login route, OR the fragment changed away from the
      // login fragment, OR the login form detached from the DOM (the app
      // replaced it with the authenticated shell).
      const loginUrl = new URL(declaration.login.route, options.origin);
      const loginPathname = loginUrl.pathname;
      const loginHash = page.url().split('#')[1] ?? '';
      const leftTheLoginRoute = (url: URL) =>
        url.pathname !== loginPathname || (url.hash.length > 0 && url.hash.slice(1) !== loginHash);
      let navigatedAway = false;
      let loginFormGone = false;
      try {
        await page.waitForURL((url) => leftTheLoginRoute(new URL(url)), {
          timeout: timeoutMs,
        });
        navigatedAway = true;
      } catch {
        // No URL movement — a fetch-based SPA submit may still have
        // succeeded. The decisive signal is the DECLARED login form's first
        // field no longer resolving: the authenticated shell replaced the
        // login view (koel keeps one unrelated form in its shell, so "any
        // form detached" would false-negative).
        const firstFieldLabel = declaration.login.fields[0]!.label;
        const byLabel = page.getByLabel(firstFieldLabel, { exact: true });
        const byPlaceholder = page.getByPlaceholder(firstFieldLabel, { exact: true });
        const resolves = (await byLabel.count()) > 0 || (await byPlaceholder.count()) > 0;
        loginFormGone = !resolves;
      }
      if (!navigatedAway && !loginFormGone) {
        // Arriving back ON the login route with the form still present means
        // the credentials were refused (or the submit never left the page) —
        // classify blocked, honestly.
        throw replayLoginError(
          subject,
          'The declared login did not leave the login route; the persona credentials were refused or the form did not submit',
        );
      }
      // #297 E2: capture the authenticated state BEFORE the context closes.
      if (captureStorageState) {
        captured = (await context.storageState()) as ReplayPersonaStorageState;
      }
    } finally {
      await context.close();
    }
  } catch (error) {
    if (error instanceof ReplayPersonaLoginError) throw error;
    throw replayLoginError(
      subject,
      `Per-pass replay-persona login failed: ${
        error instanceof Error ? redactMessage(error.message, persona) : String(error)
      }`,
    );
  } finally {
    try {
      if (browser) await browser.close();
    } catch {
      // Teardown must not mask the login result.
    }
  }
  return {
    ...(captured ? { storageState: captured } : {}),
    ...(loginSurface ? { loginSurface } : {}),
  };
}

function replayLoginError(subject: string, message: string): ReplayPersonaLoginError {
  return new ReplayPersonaLoginError(
    message,
    verifyDiagnostic(ARXIC_VERIFY_FIXTURE_LOGIN_BLOCKED, 'blocked', subject, message),
  );
}

/** Persona values are forbidden substrings everywhere (Invariants). */
function redactMessage(message: string, persona: VerificationPersona): string {
  let sanitized = message;
  for (const value of Object.values(persona)) {
    if (typeof value === 'string' && value.length > 0) {
      sanitized = sanitized.replaceAll(value, '[REDACTED]');
    }
  }
  return sanitized;
}
