export type LeaseState = {
  id: string;
  owner: string;
  expiresAt: string;
  inUse: boolean;
};

export function detectCollision(leases: readonly LeaseState[]): LeaseState | null {
  return leases.find((lease) => lease.inUse === true) ?? null;
}
