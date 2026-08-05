import { randomUUID } from 'node:crypto';
import type {
  Diagnostic,
  FixtureLease,
  FixtureProvider,
  FixtureRequirement,
} from '@arxic/contracts';
import { validateDiagnostic } from '@arxic/contracts';

export const PACKAGE_NAME = '@arxic/fixture-mailpit' as const;
export const ARXIC_FIXTURE_INBOX_MISSING = 'ARXIC-FIXTURE-INBOX-MISSING' as const;
export const ARXIC_FIXTURE_UNKNOWN_DB = 'ARXIC-FIXTURE-UNKNOWN-DB' as const;

type MailpitOptions = Readonly<{ smtp: string; api: string }>;
type InboxReadOptions = Readonly<{ subject?: string; since?: string }>;
type PersonaOptions = Readonly<{ origin: string }>;

export class FixtureServiceError extends Error {
  readonly diagnostic: Diagnostic;

  constructor(diagnostic: Diagnostic) {
    super(diagnostic.message);
    this.name = 'FixtureServiceError';
    this.diagnostic = diagnostic;
  }
}

export function fixtureDiagnostic(
  code: typeof ARXIC_FIXTURE_INBOX_MISSING | typeof ARXIC_FIXTURE_UNKNOWN_DB,
  subject: string,
  message: string,
): Diagnostic {
  const diagnostic: Diagnostic = { code, severity: 'blocked', subject, message };
  if (!validateDiagnostic(diagnostic).ok)
    throw new Error('fixture adapter made an invalid Diagnostic');
  return diagnostic;
}

export class InboxAdapter implements FixtureProvider {
  readonly #api: URL;
  readonly #recipients = new Map<string, string>();

  constructor(options: MailpitOptions) {
    const api = safeTestUrl(options.api, 'Mailpit API');
    safeTestUrl(
      options.smtp.includes('://') ? options.smtp : `smtp://${options.smtp}`,
      'Mailpit SMTP',
    );
    this.#api = api;
  }

  supports(requirement: FixtureRequirement): boolean {
    return requirement.kind === 'inbox';
  }

  async provision(requirement: FixtureRequirement): Promise<FixtureLease> {
    const recipient = requirement.parameters?.recipient;
    if (!this.supports(requirement) || !isTestEmail(recipient)) {
      throw inboxError('inbox', 'A test-sink recipient is required');
    }
    await this.#request('/api/v1/info');
    const id = `inbox:${randomUUID()}`;
    this.#recipients.set(id, recipient);
    return {
      id,
      requirement: { kind: 'inbox', parameters: { recipient: '[REDACTED]' } },
    };
  }

  async readLatest(lease: FixtureLease, options: InboxReadOptions = {}): Promise<string> {
    const recipient = this.#recipient(lease);
    if (options.since && Number.isNaN(Date.parse(options.since))) {
      throw inboxError(lease.id, 'Inbox since timestamp is invalid');
    }
    const query = [
      `to:${recipient}`,
      ...(options.subject ? [`subject:"${options.subject}"`] : []),
    ].join(' ');
    const response = await this.#request(
      `/api/v1/search?query=${encodeURIComponent(query)}&limit=50`,
    );
    const summaries = parseSummaries(await response.json());
    const matching = summaries.filter((message) => {
      if (options.subject && message.Subject !== options.subject) return false;
      if (
        options.since &&
        (!message.Created || Date.parse(message.Created) < Date.parse(options.since))
      ) {
        return false;
      }
      return true;
    });
    if (matching.length === 0) throw inboxError(lease.id, 'No matching Mailpit message was found');
    if (
      matching.length > 1 &&
      (!matching[0]?.Created || matching[0].Created === matching[1]?.Created)
    ) {
      throw inboxError(lease.id, 'Multiple indistinguishable Mailpit messages were found');
    }
    const latest = matching[0];
    if (!latest) throw inboxError(lease.id, 'No matching Mailpit message was found');
    const detail = await this.#request(`/api/v1/message/${encodeURIComponent(latest.ID)}`);
    const body = messageBody(await detail.json());
    if (!body) throw inboxError(lease.id, 'The matching Mailpit message has no readable body');
    return body;
  }

  async reset(lease: FixtureLease): Promise<void> {
    const recipient = this.#recipient(lease);
    const response = await this.#request(
      `/api/v1/search?query=${encodeURIComponent(`to:${recipient}`)}`,
      { method: 'DELETE' },
    );
    if (!response.ok) throw inboxError(lease.id, 'Mailpit refused inbox reset');
  }

  async release(lease: FixtureLease): Promise<void> {
    if (this.#recipients.has(lease.id)) await this.reset(lease);
    this.#recipients.delete(lease.id);
  }

  async #request(path: string, init?: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(new URL(path, this.#api), init);
    } catch {
      throw inboxError('mailpit', 'Mailpit test sink is unreachable');
    }
    if (!response.ok) throw inboxError('mailpit', `Mailpit API returned HTTP ${response.status}`);
    return response;
  }

  #recipient(lease: FixtureLease): string {
    const recipient = this.#recipients.get(lease.id);
    if (!recipient) throw inboxError(lease.id, 'Inbox lease is missing or released');
    return recipient;
  }
}

export class PersonaProvisioner implements FixtureProvider {
  readonly #origin: URL;
  readonly #leases = new Set<string>();

  constructor(options: PersonaOptions) {
    this.#origin = safeTestUrl(options.origin, 'Persona target');
  }

  supports(requirement: FixtureRequirement): boolean {
    return requirement.kind === 'persona';
  }

  async provision(requirement: FixtureRequirement): Promise<FixtureLease> {
    const parameters = requirement.parameters;
    const personaId = parameters?.personaId;
    const email = parameters?.email;
    const password = parameters?.password;
    const mfaSecret = parameters?.mfaSecret;
    if (
      !this.supports(requirement) ||
      typeof personaId !== 'string' ||
      !isTestEmail(email) ||
      typeof password !== 'string' ||
      password.length === 0 ||
      (mfaSecret !== undefined && (typeof mfaSecret !== 'string' || mfaSecret.length === 0))
    ) {
      throw unknownDbError('persona', 'Persona seed parameters are invalid');
    }
    let response: Response;
    try {
      response = await fetch(new URL('/__arxic/seed', this.#origin), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ personaId, email, password, ...(mfaSecret ? { mfaSecret } : {}) }),
      });
    } catch {
      throw unknownDbError(
        'persona',
        'Target seed API is unavailable; database access is forbidden',
      );
    }
    if (response.status !== 201) {
      throw unknownDbError(
        'persona',
        'Target lacks the supported seed API; database access is forbidden',
      );
    }
    const id = `persona:${randomUUID()}`;
    this.#leases.add(id);
    return {
      id,
      requirement: {
        kind: 'persona',
        parameters: {
          personaId: '[REDACTED]',
          email: '[REDACTED]',
          password: '[REDACTED]',
          ...(mfaSecret ? { mfaSecret: '[REDACTED]' } : {}),
        },
      },
    };
  }

  async reset(lease: FixtureLease): Promise<void> {
    if (!this.#leases.has(lease.id)) throw unknownDbError(lease.id, 'Persona lease is missing');
    let response: Response;
    try {
      response = await fetch(new URL('/__arxic/reset', this.#origin), { method: 'POST' });
    } catch {
      throw unknownDbError(lease.id, 'Target reset API is unavailable');
    }
    if (response.status !== 204) throw unknownDbError(lease.id, 'Target reset API was refused');
  }

  async release(lease: FixtureLease): Promise<void> {
    if (this.#leases.has(lease.id)) await this.reset(lease);
    this.#leases.delete(lease.id);
  }
}

function safeTestUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw unknownDbError(label, `${label} URL is invalid`);
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  if (
    hostname !== 'localhost' &&
    hostname !== '127.0.0.1' &&
    hostname !== '::1' &&
    !hostname.endsWith('.test') &&
    hostname !== 'mailpit'
  ) {
    throw unknownDbError(label, `${label} is not an approved test origin`);
  }
  return url;
}

function isTestEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^@\s]+@[^@\s]+\.test$/u.test(value);
}

type MessageSummary = Readonly<{ ID: string; Subject?: string; Created?: string }>;

function parseSummaries(value: unknown): MessageSummary[] {
  if (!value || typeof value !== 'object' || !('messages' in value)) return [];
  const messages = value.messages;
  if (!Array.isArray(messages)) return [];
  return messages.flatMap((message) => {
    if (!message || typeof message !== 'object' || !('ID' in message)) return [];
    if (typeof message.ID !== 'string') return [];
    const subject =
      'Subject' in message && typeof message.Subject === 'string' ? message.Subject : undefined;
    const created =
      'Created' in message && typeof message.Created === 'string' ? message.Created : undefined;
    return [
      {
        ID: message.ID,
        ...(subject ? { Subject: subject } : {}),
        ...(created ? { Created: created } : {}),
      },
    ];
  });
}

function messageBody(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  if ('Text' in value && typeof value.Text === 'string' && value.Text.length > 0) return value.Text;
  if ('HTML' in value && typeof value.HTML === 'string' && value.HTML.length > 0) return value.HTML;
  return undefined;
}

function inboxError(subject: string, message: string): FixtureServiceError {
  return new FixtureServiceError(fixtureDiagnostic(ARXIC_FIXTURE_INBOX_MISSING, subject, message));
}

function unknownDbError(subject: string, message: string): FixtureServiceError {
  return new FixtureServiceError(fixtureDiagnostic(ARXIC_FIXTURE_UNKNOWN_DB, subject, message));
}
