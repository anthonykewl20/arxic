/**
 * DG-12 (#256) exit-gate assertion helpers — shared by the dg12-*.mjs scripts.
 *
 * Pure functions over RECORDED machine artifacts (deterministic on rerun); no
 * network, no model, no writes. Every loader fails closed with a stable
 * DG12-* message on missing/malformed evidence — a missing artifact can never
 * read as a passing criterion (contract invariant 1: zero eyeballed criteria).
 *
 * Run/ledger layout (DESIGN.md §5): the DG-11 relocation runner writes
 *   <app>/runs/<runId>/artifacts/{13,10}.json  and  <runId>.json
 * and the campaign operator records the ledger as
 *   <app>/runs/<runId>.intents.json   (also accepted: <runDir>/intents.json).
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const DG12_LEDGER_SCHEMA = 'arxic-intent-ledger-v1';
export const DG12_INVENTORY_KIND = 'arxic-domain-inventory-stage-v1';

export class Dg12EvidenceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Dg12EvidenceError';
  }
}

export async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path) {
  let bytes;
  try {
    bytes = await readFile(path, 'utf8');
  } catch (error) {
    throw new Dg12EvidenceError(`cannot read ${path}: ${error.code ?? error.message}`);
  }
  try {
    return JSON.parse(bytes);
  } catch (error) {
    throw new Dg12EvidenceError(`${path} is not valid JSON: ${error.message}`);
  }
}

/** Resolves the recorded intent ledger for a run dir, or fails closed. */
export async function loadLedger(runDirectory) {
  const candidates = [
    join(runDirectory, 'intents.json'),
    `${runDirectory}.intents.json`,
    join(runDirectory, '..', `${basename(runDirectory)}.intents.json`),
  ];
  for (const candidate of candidates) {
    if (await exists(candidate)) {
      const ledger = await readJson(candidate);
      if (
        ledger?.schemaVersion !== DG12_LEDGER_SCHEMA ||
        !Array.isArray(ledger.rows) ||
        typeof ledger.generatedAt !== 'string'
      ) {
        throw new Dg12EvidenceError(
          `${candidate} is not an ${DG12_LEDGER_SCHEMA} ledger (schemaVersion/rows/generatedAt)`,
        );
      }
      return { ledger, source: candidate };
    }
  }
  throw new Dg12EvidenceError(
    `no intent ledger recorded for ${runDirectory} (looked for intents.json, ` +
      `${basename(runDirectory)}.intents.json — record it via: ` +
      `node apps/cli/dist/cli.js intents ${runDirectory} --json > <run>.intents.json)`,
  );
}

/** Loads artifacts/13.json — the Domain Inventory denominator. Fails closed. */
export async function loadInventory(runDirectory) {
  const path = join(runDirectory, 'artifacts', '13.json');
  const artifact = await readJson(path);
  const rows = artifact?.inventory?.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Dg12EvidenceError(
      `${path} does not carry a non-empty Domain Inventory (expected inventory.rows[])`,
    );
  }
  return { rows, source: path };
}

/** Loads artifacts/10.json — the recorded verifier output. Fails closed. */
export async function loadVerification(runDirectory) {
  const path = join(runDirectory, 'artifacts', '10.json');
  const artifact = await readJson(path);
  if (typeof artifact?.outcome !== 'string' || !Array.isArray(artifact.runs)) {
    throw new Dg12EvidenceError(
      `${path} does not carry the recorded verifier output (outcome + runs[])`,
    );
  }
  return { verification: artifact, source: path };
}

/**
 * Enumerates the recorded campaign runs under an app evidence directory
 * (`<app>/runs/<runId>` that contain artifacts/13.json). Zero runs → the gate
 * cannot pass (an app with no recorded campaign reads as red, never green).
 */
export async function loadAppRuns(appDirectory) {
  const runsRoot = join(resolve(appDirectory), 'runs');
  if (!(await exists(runsRoot))) {
    throw new Dg12EvidenceError(
      `${appDirectory} records no campaign runs (missing ${runsRoot}) — ` +
        `the exit gate consumes recorded campaign artifacts only; run the campaigns first`,
    );
  }
  const entries = (await readdir(runsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const runs = [];
  for (const runId of entries) {
    const runDirectory = join(runsRoot, runId);
    if (await exists(join(runDirectory, 'artifacts', '13.json')))
      runs.push({ runId, runDirectory });
  }
  if (runs.length === 0) {
    throw new Dg12EvidenceError(
      `${runsRoot} contains no run directory with artifacts/13.json — nothing to assert`,
    );
  }
  return runs;
}

/** Criterion 1 (C-3): 100% join inventory → ledger rows, disposition per row. */
export function coverageForRun(inventoryRows, ledgerRows) {
  const ledgerKeys = new Set(ledgerRows.map((row) => row.inventoryKey));
  const missing = inventoryRows.filter((row) => !ledgerKeys.has(row.key));
  const undisposed = ledgerRows.filter(
    (row) => typeof row.disposition !== 'string' || row.disposition.length === 0,
  );
  return {
    denominator: inventoryRows.length,
    covered: inventoryRows.length - missing.length,
    missingKeys: missing.map((row) => row.key),
    rowsWithoutDisposition: undisposed.map((row) => row.inventoryKey),
    passes:
      missing.length === 0 && undisposed.length === 0 && inventoryRows.length === ledgerRows.length,
  };
}

// LOCKSTEP with `sourceEvidenceId` in packages/intent/src/ledger.ts:210-216 —
// the evidence-id grammar is part of the ledger schema contract and must not
// drift. Reimplemented here (not imported) so the fabrication audit runs
// under plain `node` against already-recorded JSON, no TS/tsx runtime.
function sourceEvidenceId(ref) {
  return `src:${sanitizeEvidencePath(ref.path)}:${String(ref.startLine)}-${String(ref.endLine)}`;
}

function sanitizeEvidencePath(value) {
  return String(value).replace(/[^A-Za-z0-9._#-]/gu, '-') || 'unknown';
}

/**
 * Criterion 4 (C-6): zero fabricated intents. Independently re-derives the
 * evidence index from the recorded stage-13 inventory rows' `sourceRefs`
 * (never trusting the recorded ledger's own claim of resolvability, which
 * the DG-07 builder only enforces at BUILD time) and checks two properties
 * over the RECORDED ledger:
 *   (a) every intent's `evidenceRefIds` resolve into that index — a dangling
 *       ref is a waved-through resolvability-gate failure (fabrication);
 *   (b) no row whose disposition is not `extracted` carries an intent (an
 *       intent can only exist against an actually-extracted inventory row).
 */
export function fabricationAuditForRun(inventoryRows, ledgerRows) {
  const evidenceIndex = new Set();
  for (const row of inventoryRows) {
    for (const ref of row.sourceRefs ?? []) evidenceIndex.add(sourceEvidenceId(ref));
  }
  const extractedKeys = new Set(
    inventoryRows.filter((row) => row.disposition === 'extracted').map((row) => row.key),
  );
  const danglingRefs = [];
  const fabricatedRowKeys = [];
  let intentCount = 0;
  for (const row of ledgerRows) {
    const intents = row.intents ?? [];
    if (intents.length > 0 && !extractedKeys.has(row.inventoryKey)) {
      fabricatedRowKeys.push(row.inventoryKey);
    }
    for (const intent of intents) {
      intentCount += 1;
      for (const ref of intent.evidenceRefIds ?? []) {
        if (!evidenceIndex.has(ref)) {
          danglingRefs.push(`${row.inventoryKey}/${intent.proposalId ?? '?'}: ${ref}`);
        }
      }
    }
  }
  return {
    intentCount,
    danglingRefs,
    fabricatedRowKeys,
    passes: danglingRefs.length === 0 && fabricatedRowKeys.length === 0,
  };
}

/**
 * Criterion 2 (C-4): a row carries a grounded intent iff it has ≥1 intent that
 * cites evidence (`evidenceRefIds` non-empty) — the builder's fail-closed
 * resolvability gate (criterion 4) guarantees those refs resolve to source
 * evidence, so the script never re-adjudicates grounding by eyeball.
 */
export function groundedRatioForRun(ledgerRows) {
  const grounded = ledgerRows.filter(
    (row) =>
      Array.isArray(row.intents) &&
      row.intents.some((intent) => (intent.evidenceRefIds ?? []).length > 0),
  );
  return {
    denominator: ledgerRows.length,
    grounded: grounded.length,
    ungroundedKeys: ledgerRows
      .filter((row) => !grounded.includes(row))
      .map((row) => row.inventoryKey),
    ratio: ledgerRows.length === 0 ? 0 : grounded.length / ledgerRows.length,
  };
}

/**
 * Criterion 3 (C-5): replay counts from the recorded ledger rows (the ledger
 * builder consumes the verifier output wholesale, so per-row replayStatus IS
 * the recorded verifier output). Attempted must be > 0 — zero attempts can
 * never read as 100%.
 */
export function replayRatioForLedgers(ledgerRows) {
  let attempted = 0;
  let passed = 0;
  const failedKeys = [];
  for (const row of ledgerRows) {
    if (String(row.replayStatus ?? '').startsWith('attempted:')) {
      attempted += 1;
      if (row.replayStatus === 'attempted:passed') passed += 1;
      else failedKeys.push(`${row.inventoryKey} (${row.replayStatus})`);
    }
  }
  return {
    attempted,
    passed,
    failedKeys,
    ratio: attempted === 0 ? 0 : passed / attempted,
  };
}

/** Strips volatile timestamp fields for byte-stable comparisons (C-7). */
export function stableLedgerJson(ledger) {
  const { generatedAt, ...stable } = ledger;
  void generatedAt;
  return JSON.stringify(sortKeysDeep(stable));
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeysDeep(value[key])]),
    );
  }
  return value;
}

/** Reports ledger differences as OBSERVED model-sampling attribution (C-7). */
export function attributeLedgerDifferences(run1Ledger, run2Ledger) {
  const rows1 = new Map(run1Ledger.rows.map((row) => [row.inventoryKey, row]));
  const rows2 = new Map(run2Ledger.rows.map((row) => [row.inventoryKey, row]));
  const differences = [];
  for (const [key, row1] of rows1) {
    const row2 = rows2.get(key);
    if (row2 === undefined) {
      differences.push(`OBSERVED model-sampling attribution: row ${key} present in run-1 only`);
      continue;
    }
    const i1 = (row1.intents ?? [])
      .map((intent) => intent.intent)
      .sort()
      .join(' | ');
    const i2 = (row2.intents ?? [])
      .map((intent) => intent.intent)
      .sort()
      .join(' | ');
    if (i1 !== i2) {
      differences.push(
        `OBSERVED model-sampling attribution: row ${key} intents differ (run-1: [${i1}] vs run-2: [${i2}])`,
      );
    }
  }
  for (const key of rows2.keys()) {
    if (!rows1.has(key)) {
      differences.push(`OBSERVED model-sampling attribution: row ${key} present in run-2 only`);
    }
  }
  return differences;
}

function basename(path) {
  const parts = path.replace(/\/+$/u, '').split('/');
  return parts[parts.length - 1];
}

/** Exit-code wrapper for direct CLI use. */
export async function runGate(main) {
  try {
    const verdict = await main();
    if (verdict !== true) {
      console.error(`DG12 GATE: FAIL`);
      process.exitCode = 1;
    } else {
      console.log(`DG12 GATE: PASS`);
    }
  } catch (error) {
    console.error(
      `DG12 GATE: FAIL — ${error instanceof Dg12EvidenceError ? error.message : (error?.stack ?? String(error))}`,
    );
    process.exitCode = 1;
  }
}
