/** Theme preference lives in one place; tokens.css reacts to the data-theme attribute. */
const key = 'arxic-theme';
export type Theme = 'light' | 'dark' | 'system';
export function currentTheme(): Theme {
  try {
    const value = localStorage.getItem(key);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}
export function applyTheme(theme: Theme) {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  try {
    if (theme === 'system') localStorage.removeItem(key);
    else localStorage.setItem(key, theme);
  } catch {
    /* storage may be unavailable; the attribute still applies for this page */
  }
}
export function resolvedTheme(): 'light' | 'dark' {
  const theme = currentTheme();
  if (theme !== 'system') return theme;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
export function initTheme() {
  applyTheme(currentTheme());
}
