/** Shared literal control vocabulary; declarations are not runtime interaction proof. */
export const frontendControlTags = new Set([
  'button',
  'input',
  'textarea',
  'select',
  'a',
  'form',
  'dialog',
  'details',
  'summary',
]);
export const frontendStateAttributes = new Set([
  'disabled',
  'hidden',
  'aria-expanded',
  'aria-busy',
  'aria-invalid',
]);
