import { useEffect, useSyncExternalStore } from 'react';
import { CommandPalette, type Command } from './components';

/**
 * The palette's contents change with the workspace (projects and runs come and
 * go), while the shell that hosts it is mounted once. Publishing commands
 * through a small store keeps that split: the action layer republishes on every
 * refresh and the shell never remounts.
 *
 * Open state lives here too, so the topbar's Search button and the ⌘K shortcut
 * drive one palette without the shell threading a callback down.
 */
type Registry = { commands: Command[]; open: boolean };
let registry: Registry = { commands: [], open: false };
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const publish = () => {
  for (const listener of listeners) listener();
};
const snapshot = () => registry;

export function updateCommands(commands: Command[]) {
  registry = { ...registry, commands };
  publish();
}
export function setCommandPaletteOpen(open: boolean) {
  if (registry.open === open) return;
  registry = { ...registry, open };
  publish();
}

/** Owns the Ctrl+K / ⌘K shortcut and renders the palette over the workspace. */
export function CommandBar() {
  const { commands, open } = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'k' || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      setCommandPaletteOpen(!registry.open);
    };
    const onClick = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest('#open-command-palette'))
        setCommandPaletteOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('click', onClick);
    };
  }, []);
  return (
    <CommandPalette commands={commands} open={open} onClose={() => setCommandPaletteOpen(false)} />
  );
}
