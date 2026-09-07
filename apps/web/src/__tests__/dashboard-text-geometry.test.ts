import { expect, it } from 'vitest';
import { textFitsBox } from './dashboard-readability';

it('compares the retained Firefox boundary at the declared measurement resolution', () => {
  // CI 34071728564: spacing/light and dark, text-25-containment.
  const box = { x: 256, y: -300.5, right: 615.01666259765625, bottom: -279.5 };
  const line = { ...box, right: 615.0166778564453125 };
  expect(textFitsBox(box, [line])).toBe(true);
});

it.each(['x', 'y', 'right', 'bottom'] as const)(
  'still rejects a 1/64 CSS pixel spill on the %s edge',
  (edge) => {
    const box = { x: 10, y: 10, right: 100, bottom: 30 };
    const line = { ...box, [edge]: box[edge] + (edge === 'x' || edge === 'y' ? -1 : 1) / 64 };
    expect(textFitsBox(box, [line])).toBe(false);
  },
);

it('does not pass missing text or non-finite measurements', () => {
  const box = { x: 10, y: 10, right: 100, bottom: 30 };
  expect(textFitsBox(box, [])).toBe(false);
  for (const right of [NaN, Infinity, -Infinity]) {
    expect(textFitsBox(box, [{ ...box, right }])).toBe(false);
    expect(textFitsBox({ ...box, right }, [box])).toBe(false);
  }
});
