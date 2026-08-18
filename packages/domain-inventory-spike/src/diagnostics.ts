import type { Diagnostic } from '@arxic/contracts';

/** Stable diagnostics for the Domain Inventory (ADR §10.4 shape). */
export const ARXIC_INVENTORY_INTERCHANGE_INVALID = 'ARXIC-INVENTORY-INTERCHANGE-INVALID' as const;
export const ARXIC_INVENTORY_ROW_INVALID = 'ARXIC-INVENTORY-ROW-INVALID' as const;
export const ARXIC_INVENTORY_COMPLETENESS = 'ARXIC-INVENTORY-COMPLETENESS' as const;
export const ARXIC_INVENTORY_STANDIN = 'ARXIC-INVENTORY-STANDIN' as const;
export const ARXIC_INVENTORY_URI_COLLISION = 'ARXIC-INVENTORY-URI-COLLISION' as const;
export const ARXIC_INVENTORY_PROVIDER_INCLUDE_RESOLVED =
  'ARXIC-INVENTORY-PROVIDER-INCLUDE-RESOLVED' as const;
export const ARXIC_INVENTORY_PROVIDER_INCLUDE_UNRESOLVED =
  'ARXIC-INVENTORY-PROVIDER-INCLUDE-UNRESOLVED' as const;

export type InventoryDiagnosticCode =
  | typeof ARXIC_INVENTORY_INTERCHANGE_INVALID
  | typeof ARXIC_INVENTORY_ROW_INVALID
  | typeof ARXIC_INVENTORY_COMPLETENESS
  | typeof ARXIC_INVENTORY_STANDIN
  | typeof ARXIC_INVENTORY_URI_COLLISION
  | typeof ARXIC_INVENTORY_PROVIDER_INCLUDE_RESOLVED
  | typeof ARXIC_INVENTORY_PROVIDER_INCLUDE_UNRESOLVED;

export function inventoryDiagnostic(
  code: InventoryDiagnosticCode,
  subject: string,
  message: string,
  severity: 'blocked' | 'observed' = 'blocked',
): Diagnostic {
  return { code, severity, subject, message };
}
