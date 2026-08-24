import type { Diagnostic } from '@arxic/contracts';
import { chromium } from '@playwright/test';
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
export async function loginReplayPersona(options: {
  origin: string;
  declaration: ReplayPersonaDeclaration;
  persona: VerificationPersona;
  subject: string;
  timeoutMs?: number;
}): Promise<void> {
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
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(new URL(declaration.login.route, options.origin).href, {
        waitUntil: 'load',
        timeout: timeoutMs,
      });
      const form = page
        .locator('form')
        .filter({ has: page.getByLabel(declaration.login.fields[0]!.label, { exact: true }) })
        .filter({
          has: page.getByRole('button', { name: declaration.login.submit.label, exact: true }),
        });
      if ((await form.count()) !== 1) {
        throw replayLoginError(
          subject,
          'The declared login form was not uniquely found on the login route (semantic form scoping failed)',
        );
      }
      for (const field of declaration.login.fields) {
        await form.getByLabel(field.label, { exact: true }).fill(valueFor(field.inputRef)!, {
          timeout: timeoutMs,
        });
      }
      await form.getByRole('button', { name: declaration.login.submit.label, exact: true }).click({
        timeout: timeoutMs,
      });
      // Deterministically wait for the submit navigation to commit AWAY from
      // the login route (waitForLoadState alone can resolve on the pre-submit
      // document while the POST is still in flight).
      const loginPathname = new URL(declaration.login.route, options.origin).pathname;
      try {
        await page.waitForURL((url) => new URL(url).pathname !== loginPathname, {
          timeout: timeoutMs,
        });
      } catch {
        // Arriving back ON the login route means the credentials were refused
        // (or the submit never left the page) — classify blocked, honestly.
        throw replayLoginError(
          subject,
          'The declared login did not leave the login route; the persona credentials were refused or the form did not submit',
        );
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
