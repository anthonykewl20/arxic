import type { VisualCheck } from './visual-oracle';

export const paintGaps = [
  'complex-paint',
  'occluded-text',
  'masked-text',
  'inactive-or-semantic-exception',
  'missing-opaque-background',
  'unsupported-color',
  'unavailable-font',
  'collection-budget',
] as const;
export type TextPaint = {
  id: number;
  box: { x: number; y: number; width: number; height: number };
  foreground: [number, number, number] | null;
  background: [number, number, number] | null;
  fontSize: number;
  fontWeight: number;
  unavailable: (typeof paintGaps)[number] | null;
};

/** Host-side allow-list validation; arbitrary browser strings are never evidence. */
export function validTextPaint(value: unknown): value is TextPaint[] {
  if (!Array.isArray(value) || value.length > 2000) return false;
  const ids = new Set<number>();
  const color = (v: unknown) =>
    v === null ||
    (Array.isArray(v) &&
      v.length === 3 &&
      v.every((c) => typeof c === 'number' && Number.isFinite(c) && c >= 0 && c <= 255));
  return value.every((v) => {
    if (!v || !Number.isSafeInteger(v.id) || v.id < 0 || ids.has(v.id)) return false;
    ids.add(v.id);
    return (
      v.box &&
      [v.box.x, v.box.y, v.box.width, v.box.height, v.fontSize, v.fontWeight].every(
        Number.isFinite,
      ) &&
      v.box.width > 0 &&
      v.box.height > 0 &&
      v.fontSize > 0 &&
      v.fontWeight >= 1 &&
      v.fontWeight <= 1000 &&
      color(v.foreground) &&
      color(v.background) &&
      (v.unavailable === null || paintGaps.includes(v.unavailable)) &&
      (v.unavailable !== null || (v.foreground !== null && v.background !== null))
    );
  });
}

/** WCAG 2 relative luminance. Ratios are compared before presentation rounding. */
function luminance(color: [number, number, number]): number {
  const linear = color.map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** Applicability and verdict belong to this action, never to a model. */
export function assessTextContrast(paints: TextPaint[], stable: boolean): VisualCheck[] {
  const valid = validTextPaint(paints);
  if (!valid)
    return [
      {
        id: 'text-contrast-evidence',
        kind: 'hard',
        verdict: 'unverified',
        expected: 'Finite, bounded text-paint evidence under the solid-paint-v1 profile.',
        measurementIds: [],
        reason: 'Malformed text-paint evidence.',
      },
    ];
  return paints.map((paint, index) => {
    const threshold =
      paint.fontSize >= 24 || (paint.fontSize >= 56 / 3 && paint.fontWeight >= 700) ? 3 : 4.5;
    const applicable = stable && paint.unavailable === null;
    const a = paint.foreground ? luminance(paint.foreground) : 0;
    const b = paint.background ? luminance(paint.background) : 0;
    const observed = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    return {
      id: `text-contrast-${paint.id}`,
      region: { ...paint.box },
      kind: 'hard',
      verdict: applicable ? (observed < threshold ? 'fail' : 'pass') : 'unverified',
      expected: `Solid-paint text contrast >= ${threshold}:1 (WCAG 1.4.3 numeric threshold; scoped text profile, not whole-page certification).`,
      measurementIds: [
        `textPaint[${index}].box`,
        `textPaint[${index}].foreground`,
        `textPaint[${index}].background`,
        `textPaint[${index}].fontSize`,
        `textPaint[${index}].fontWeight`,
      ],
      reason: applicable
        ? 'Opaque sRGB text on a resolved solid background; no supported-profile paint obstruction observed.'
        : !stable
          ? 'Stable screenshot and finite scene evidence are required.'
          : `Unverified: ${paint.unavailable}.`,
      ...(applicable ? { observed, threshold, delta: observed - threshold } : {}),
    };
  });
}
