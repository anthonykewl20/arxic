export const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
export const pill = (value) => `<span class="pill ${escape(value)}">${escape(value)}</span>`;
export const time = (value) =>
  value ? `${new Date(value).toISOString().slice(0, 19).replace('T', ' ')} UTC` : '—';
