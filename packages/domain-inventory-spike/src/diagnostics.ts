import type { Diagnostic } from '@arxic/contracts';

/** Stable diagnostics for the DG-02 domain-inventory spike (ADR §10.4 shape). */
export const ARXIC_INVENTORY_INTERCHANGE_INVALID = 'ARXIC-INVENTORY-INTERCHANGE-INVALID' as const;
export const ARXIC_INVENTORY_ROW_INVALID = 'ARXIC-INVENTORY-ROW-INVALID' as const;
export const ARXIC_INVENTORY_COMPLETENESS = 'ARXIC-INVENTORY-COMPLETENESS' as const;
export const ARXIC_INVENTORY_STANDIN = 'ARXIC-INVENTORY-STANDIN' as const;

export type InventoryDiagnosticCode =
  | typeof ARXIC_INVENTORY_INTERCHANGE_INVALID
  | typeof ARXIC_INVENTORY_ROW_INVALID
  | typeof ARXIC_INVENTORY_COMPLETENESS
  | typeof ARXIC_INVENTORY_STANDIN;

export function inventoryDiagnostic(
  code: InventoryDiagnosticCode,
  subject: string,
  message: string,
): Diagnostic {
  return { code, severity: 'blocked', subject, message };
}
