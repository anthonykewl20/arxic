/**
 * Keep keyboard traversal inside the active modal, including browser-chrome wrap.
 *
 * `element` is required when the handler runs from React: a synthetic event's
 * `nativeEvent.currentTarget` is already null by the time React dispatches, so
 * the dialog cannot be recovered from the event itself. Native
 * `addEventListener` callers pass nothing and keep using `currentTarget`.
 */
export function trapDialogTab(
  event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault' | 'currentTarget'>,
  element?: HTMLDialogElement | null,
) {
  if (event.key !== 'Tab') return;
  const dialog = element ?? (event.currentTarget as HTMLDialogElement | null);
  if (!dialog?.open) return;
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
