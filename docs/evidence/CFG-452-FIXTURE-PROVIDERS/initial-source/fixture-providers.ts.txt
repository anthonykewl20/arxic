/** Managed adapter identifiers, not arbitrary plugin names or credential values. */
const providers = {
  inbox: 'captured-mail-sink',
  otp: 'test-otp',
  personaProvisioner: 'app-seed-api',
} as const;

export function unsupportedFixtureProviders(
  fixtures: Record<string, unknown>,
): Array<{ field: string; reason: string }> {
  return Object.entries(providers).flatMap(([field, supported]) =>
    fixtures[field] !== undefined && fixtures[field] !== supported
      ? [{ field, reason: `must be ${supported} when declared` }]
      : [],
  );
}
