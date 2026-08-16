import type { Diagnostic } from '@arxic/contracts';
import {
  ARXIC_INVENTORY_COMPLETENESS,
  ARXIC_INVENTORY_ROW_INVALID,
  inventoryDiagnostic,
} from './diagnostics';
import type { DomainInventory, InventoryDisposition, InventoryRow } from './types';

const DISPOSITIONS: readonly InventoryDisposition[] = [
  'extracted',
  'unsupported',
  'unsafe',
  'unextracted-with-reason',
];

export type InventoryValidation = { ok: true } | { ok: false; diagnostics: Diagnostic[] };

/**
 * Fail-closed inventory validation. Proves the binding completeness invariant
 * — total rows equals the sum of dispositions — by INDEPENDENT recount (the
 * builder's stats are an input to check, not a source of truth), and enforces
 * the no-silent-drop rules: unique fusion keys, a disposition from the enum on
 * every row, a non-empty reason on every non-extracted row, and non-empty
 * line-anchored source evidence on every extracted row.
 */
export function validateInventory(inventory: DomainInventory): InventoryValidation {
  const diagnostics: Diagnostic[] = [];
  const reject = (subject: string, message: string) => {
    diagnostics.push(inventoryDiagnostic(ARXIC_INVENTORY_ROW_INVALID, subject, message));
  };

  if (!Array.isArray(inventory.rows)) {
    diagnostics.push(
      inventoryDiagnostic(ARXIC_INVENTORY_ROW_INVALID, 'inventory.rows', 'rows must be an array.'),
    );
    return { ok: false, diagnostics };
  }

  const seenKeys = new Set<string>();
  inventory.rows.forEach((row: InventoryRow, index) => {
    const subject = `inventory.rows[${index}]`;
    if (typeof row !== 'object' || row === null) {
      reject(subject, 'Row must be an object.');
      return;
    }
    if (!DISPOSITIONS.includes(row.disposition)) {
      reject(`${subject}.disposition`, `Disposition must be one of ${DISPOSITIONS.join(', ')}.`);
    }
    if (
      row.disposition !== 'extracted' &&
      (typeof row.reason !== 'string' || row.reason.length === 0)
    ) {
      reject(`${subject}.reason`, 'Every non-extracted row requires a non-empty reason.');
    }
    if (
      row.disposition === 'extracted' &&
      (!Array.isArray(row.sourceRefs) || row.sourceRefs.length === 0)
    ) {
      reject(
        `${subject}.sourceRefs`,
        'An extracted row must be grounded by ≥1 source EvidenceRef.',
      );
    }
    if (typeof row.key !== 'string' || row.key.length === 0) {
      reject(`${subject}.key`, 'Row key is required.');
    } else if (seenKeys.has(row.key)) {
      reject(`${subject}.key`, `Duplicate fusion key ${row.key} — dedupe is structural.`);
    } else {
      seenKeys.add(row.key);
    }
    for (const ref of row.sourceRefs ?? []) {
      if (
        ref.kind !== 'source' ||
        typeof ref.path !== 'string' ||
        typeof ref.startLine !== 'number' ||
        typeof ref.endLine !== 'number' ||
        ref.startLine < 1 ||
        ref.startLine > ref.endLine
      ) {
        reject(`${subject}.sourceRefs`, 'Source refs must be line-anchored (1 ≤ start ≤ end).');
        break;
      }
    }
  });

  const recount = Object.fromEntries(DISPOSITIONS.map((d) => [d, 0])) as Record<
    InventoryDisposition,
    number
  >;
  for (const row of inventory.rows) {
    if (DISPOSITIONS.includes(row.disposition)) recount[row.disposition] += 1;
  }
  const sum = Object.values(recount).reduce((a, b) => a + b, 0);
  if (inventory.rows.length !== sum || inventory.stats.totalRows !== inventory.rows.length) {
    diagnostics.push(
      inventoryDiagnostic(
        ARXIC_INVENTORY_COMPLETENESS,
        'inventory.stats',
        `Completeness violated: rows=${inventory.rows.length} sum(dispositions)=${sum} stats.totalRows=${inventory.stats.totalRows}.`,
      ),
    );
  }
  for (const disposition of DISPOSITIONS) {
    if (inventory.stats.byDisposition[disposition] !== recount[disposition]) {
      diagnostics.push(
        inventoryDiagnostic(
          ARXIC_INVENTORY_COMPLETENESS,
          `inventory.stats.byDisposition.${disposition}`,
          `Stats claim ${inventory.stats.byDisposition[disposition]} but recount finds ${recount[disposition]}.`,
        ),
      );
    }
  }

  return diagnostics.length === 0 ? { ok: true } : { ok: false, diagnostics };
}
