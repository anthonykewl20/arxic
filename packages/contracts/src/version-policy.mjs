/** Owner's release counter: minor +100, patch +1; labels have a v prefix. */
export function canonicalVersion(value) {
  const match = typeof value === 'string' && /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(\d+)$/u.exec(value);
  if (!match) throw new Error('Version must be a numeric major.line.counter value');
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part)))
    throw new Error('Version counter exceeds the safe integer range');
  return parts.join('.');
}

export function formatVersionLabel(value) {
  const [major, line, counter] = canonicalVersion(value).split('.');
  return `v${major}.${line}.${counter.padStart(3, '0')}`;
}

export function bumpVersion(value, kind) {
  if (kind !== 'minor' && kind !== 'patch') throw new Error('Choose minor (+100) or patch (+1)');
  const [major, line, counter] = canonicalVersion(value).split('.').map(Number);
  return canonicalVersion(`${major}.${line}.${counter + (kind === 'minor' ? 100 : 1)}`);
}
