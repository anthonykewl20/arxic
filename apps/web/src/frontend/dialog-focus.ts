/** Keep keyboard traversal inside the active modal, including browser-chrome wrap. */
export function trapDialogTab(event: KeyboardEvent) {
  if (event.key !== 'Tab') return;
  const dialog = event.currentTarget as HTMLDialogElement;
  if (!dialog.open) return;
  const targets = [
    ...dialog.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex]'),
  ].filter(
    (el) =>
      el.tabIndex >= 0 &&
      !el.matches(':disabled') &&
      el.getClientRects().length > 0 &&
      getComputedStyle(el).visibility !== 'hidden',
  );
  const first = targets[0],
    last = targets.at(-1);
  if (!first || !last) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  if (
    event.shiftKey &&
    (document.activeElement === first || !dialog.contains(document.activeElement))
  ) {
    event.preventDefault();
    last.focus();
  } else if (
    !event.shiftKey &&
    (document.activeElement === last || !dialog.contains(document.activeElement))
  ) {
    event.preventDefault();
    first.focus();
  }
}
