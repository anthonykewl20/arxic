/**
 * The one way the dashboard talks to the credential vault.
 *
 * Two screens need it — the workspace-wide list under Settings, and the
 * sign-in section of a project's own settings, where the person setting up a
 * project would rather not be sent somewhere else to finish the job. Both go
 * through here so the wording, the statuses and the write-only contract are
 * decided once.
 *
 * Write-only by construction: a value can be set or removed, never read back.
 * The server returns reference NAMES and whether each resolves — never a value.
 */
export type Credential = {
  ref: string;
  uses: string[];
  status: 'vault' | 'environment' | 'missing';
};
export type CredentialInventory = {
  keySource: 'environment' | 'file';
  keyPath?: string;
  credentials: Credential[];
  orphaned: string[];
};

export const credentialStatus: Record<
  Credential['status'],
  { label: string; tone: 'success' | 'info' | 'warning' }
> = {
  vault: { label: 'Stored here', tone: 'success' },
  environment: { label: 'From server environment', tone: 'info' },
  missing: { label: 'Not set', tone: 'warning' },
};

export async function credentialRequest(
  method: 'GET' | 'POST' | 'DELETE',
  body?: unknown,
): Promise<CredentialInventory> {
  const response = await fetch('/api/secrets', {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const data = (await response.json().catch(() => ({}))) as CredentialInventory & {
    error?: string;
  };
  if (!response.ok) throw new Error(data.error ?? 'Credential request failed');
  return data;
}

/**
 * A reference name derived from the project.
 *
 * People asked to invent an `ARXIC_SECRET_` name either reuse one by accident
 * or produce something nobody can place later. Naming it after the project and
 * the role makes both the vault list and a leaked environment variable
 * self-explanatory.
 */
export function suggestRef(projectName: string, role: 'email' | 'password') {
  const slug =
    projectName
      .toUpperCase()
      .replace(/[^A-Z0-9]+/gu, '_')
      .replace(/^_+|_+$/gu, '')
      .slice(0, 40) || 'PROJECT';
  return `ARXIC_SECRET_${slug}_${role.toUpperCase()}`;
}
