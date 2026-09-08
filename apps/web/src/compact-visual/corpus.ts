import { sha256 } from '@arxic/contracts';

/**
 * Deterministic corpus planning for the multi-family clipping/overflow corpus
 * (refs #423). Pure module: no browser, docker or filesystem access — the
 * capture mechanics live in corpus-capture.ts. The allocation is frozen here
 * before any labels are consumed for training or model selection (spec §9:
 * 60/20/20 by application family, seed 423, explicit group-count rounding
 * only).
 */
export type Variant = {
  id: string;
  /** Per-head controlled labels: index 0 = clipping, index 3 = overflow; null = not addressed. */
  labels: (0 | 1 | null)[];
  labelOrigin: 'controlled-regression' | 'controlled-negative';
  /** Whether the mutation moves the required control (clipping regressions do; negatives must not). */
  moveControl: boolean;
  /** Visible fraction of the control retained for graded clips (1 = fully off-screen). */
  clipKeep?: number;
  clipDirection?: 'right' | 'down';
  clipFull?: boolean;
};

const CLIP_NEGATIVE: (0 | 1 | null)[] = [0, null, null, 0, null, null];
const clip = (label: 0 | 1) => [label, null, null, 0, null, null] as (0 | 1 | null)[];

export const VARIANT_REGISTRY: Record<string, Variant> = {
  clean: {
    id: 'clean',
    labels: CLIP_NEGATIVE,
    labelOrigin: 'controlled-negative',
    moveControl: false,
  },
  'clip-full': {
    id: 'clip-full',
    labels: clip(1),
    labelOrigin: 'controlled-regression',
    moveControl: true,
    clipFull: true,
    clipDirection: 'right',
  },
  'clip-right-75': {
    id: 'clip-right-75',
    labels: clip(1),
    labelOrigin: 'controlled-regression',
    moveControl: true,
    clipKeep: 0.75,
    clipDirection: 'right',
  },
  'clip-right-50': {
    id: 'clip-right-50',
    labels: clip(1),
    labelOrigin: 'controlled-regression',
    moveControl: true,
    clipKeep: 0.5,
    clipDirection: 'right',
  },
  'clip-right-25': {
    id: 'clip-right-25',
    labels: clip(1),
    labelOrigin: 'controlled-regression',
    moveControl: true,
    clipKeep: 0.25,
    clipDirection: 'right',
  },
  'clip-bottom-50': {
    id: 'clip-bottom-50',
    labels: clip(1),
    labelOrigin: 'controlled-regression',
    moveControl: true,
    clipKeep: 0.5,
    clipDirection: 'down',
  },
  'overflow-x': {
    id: 'overflow-x',
    // Layout-neutral overflow regression: the required control stays put while
    // the document scrollport overflows horizontally; clipping stays negative.
    labels: [0, null, null, 1, null, null],
    labelOrigin: 'controlled-regression',
    moveControl: false,
  },
  'content-change': {
    id: 'content-change',
    labels: CLIP_NEGATIVE,
    labelOrigin: 'controlled-negative',
    moveControl: false,
  },
  'overlay-adjacent': {
    id: 'overlay-adjacent',
    labels: CLIP_NEGATIVE,
    labelOrigin: 'controlled-negative',
    moveControl: false,
  },
  'style-tweak': {
    id: 'style-tweak',
    labels: CLIP_NEGATIVE,
    labelOrigin: 'controlled-negative',
    moveControl: false,
  },
};
export const VARIANT_IDS = Object.keys(VARIANT_REGISTRY);

export type CorpusPlan = {
  version: 1;
  families: string[];
  viewports: number[];
  variants: string[];
  allocationSeed: number;
  criterion: string;
};
export type Allocation = { train: string[]; calibration: string[]; test: string[] };
export type FrozenPlan = CorpusPlan & {
  allocation: Allocation;
  frozenAllocationHash: string;
};

/**
 * Documented group allocation (frozen before training, spec §9): families sort
 * ascending, shuffle stably by sha256(`${family}:${seed}`), then train =
 * round(0.6·n), calibration = max(1, round(0.2·n)) capped by the remainder, and
 * the rest are test. Two families therefore allocate 1/1/0 and five allocate
 * 3/1/1 — group-count rounding is explicit, families never split.
 */
export function allocateSplits(plan: CorpusPlan): Allocation {
  const ordered = [...plan.families].sort();
  const shuffled = ordered
    .map((family) => ({ family, key: sha256(`${family}:${plan.allocationSeed}`) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.family.localeCompare(b.family)))
    .map((entry) => entry.family);
  const n = shuffled.length;
  const train = Math.max(1, Math.round(0.6 * n));
  const calibration = Math.min(n - train, Math.max(1, Math.round(0.2 * n)));
  return {
    train: shuffled.slice(0, train),
    calibration: shuffled.slice(train, train + calibration),
    test: shuffled.slice(train + calibration),
  };
}

export function validateCorpusPlan(plan: CorpusPlan): FrozenPlan {
  if (
    !Array.isArray(plan.families) ||
    plan.families.length < 2 ||
    plan.families.some((f) => typeof f !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(f))
  )
    throw new Error('insufficient-families');
  if (new Set(plan.families).size !== plan.families.length) throw new Error('duplicate-family');
  if (
    !Array.isArray(plan.viewports) ||
    !plan.viewports.length ||
    plan.viewports.some((w) => !Number.isInteger(w) || w < 320 || w > 2048)
  )
    throw new Error('invalid-viewport');
  if (
    !Array.isArray(plan.variants) ||
    !plan.variants.length ||
    plan.variants.some((v) => !(v in VARIANT_REGISTRY))
  )
    throw new Error('unknown-variant');
  const allocation = allocateSplits(plan);
  return {
    ...plan,
    allocation,
    frozenAllocationHash: sha256(JSON.stringify(allocation)),
  };
}

export type OracleOutcome = { verdict: 'pass' | 'fail'; ok: boolean; reason?: string };

/** Graded clips must land within this measured-clip tolerance of their keep fraction. */
export const GRADED_CLIP_TOLERANCE = 0.12;

/**
 * Independent label oracle for the required-submit-inside-viewport criterion:
 * the measured clip fraction decides, never the mutation intent. A case whose
 * measurement contradicts its variant direction (or misses the graded tolerance)
 * is skipped from the corpus rather than admitted with a wrong label.
 */
export function evaluateOracle(variantId: string, clip: number): OracleOutcome {
  const variant = VARIANT_REGISTRY[variantId];
  if (!variant) throw new Error('unknown-variant');
  const failed = clip < 1;
  const verdict = failed ? 'fail' : 'pass';
  if (failed !== (variant.labels[0] === 1))
    return { verdict, ok: false, reason: 'controlled-oracle-failed' };
  if (variant.clipKeep !== undefined && Math.abs(clip - variant.clipKeep) > GRADED_CLIP_TOLERANCE)
    return { verdict, ok: false, reason: 'graded-clip-tolerance' };
  return { verdict, ok: true };
}

/**
 * Independent oracle for the scrollport-overflow criterion: any measured
 * overflow on the declared scrollport (spec §8.1 features 12–13) is the defect
 * signal; the mutation intent never decides. A measurement that contradicts
 * the variant's overflow direction skips the case rather than mislabeling it.
 */
export function evaluateOverflowOracle(
  variantId: string,
  overflowX: number,
  overflowY: number,
): OracleOutcome {
  const variant = VARIANT_REGISTRY[variantId];
  if (!variant) throw new Error('unknown-variant');
  const failed = overflowX > 0 || overflowY > 0;
  const verdict = failed ? 'fail' : 'pass';
  if (failed !== (variant.labels[3] === 1))
    return { verdict, ok: false, reason: 'overflow-oracle-failed' };
  return { verdict, ok: true };
}
