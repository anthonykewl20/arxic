/** Dashboard timestamps use an explicit timezone, including provider metadata. */
export const time = (value: string | null) =>
  value ? `${new Date(value).toISOString().slice(0, 19).replace('T', ' ')} UTC` : '—';

/**
 * How long ago, in the words people use.
 *
 * Precise UTC stamps stay on the run record, where reproducing an execution
 * needs them. On a page card the only question is whether the evidence is
 * fresh, and "2 hours ago" answers it without arithmetic. The exact stamp is
 * always one hover away — `time` is what goes in the `title`.
 */
export function ago(value: string | null, now = Date.now()) {
  if (!value) return 'never';
  const seconds = Math.round((now - new Date(value).getTime()) / 1000);
  if (!Number.isFinite(seconds)) return 'never';
  if (seconds < 0) return 'just now';
  const units: Array<[number, string]> = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [7, 'day'],
    [4.35, 'week'],
    [12, 'month'],
  ];
  let amount = seconds;
  for (const [size, unit] of units) {
    if (amount < size) {
      const rounded = Math.floor(amount);
      if (unit === 'second' && rounded < 45) return 'just now';
      return `${rounded} ${unit}${rounded === 1 ? '' : 's'} ago`;
    }
    amount /= size;
  }
  const years = Math.floor(amount);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}
