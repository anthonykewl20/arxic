/** Dashboard timestamps use an explicit timezone, including provider metadata. */
export const time = (value: string | null) =>
  value ? `${new Date(value).toISOString().slice(0, 19).replace('T', ' ')} UTC` : '—';
