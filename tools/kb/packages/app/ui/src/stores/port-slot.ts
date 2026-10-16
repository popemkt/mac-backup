/**
 * A port a plugin installs while it is loaded and the shell listens to:
 * one installed value at a time, else the port's empty one, and one stable
 * subscription that follows whichever is installed. The page's projection
 * and its editor are each one of these.
 */

/** A port the shell can listen to: it says when what it answers changes. */
interface Observed {
  readonly subscribe: (listener: () => void) => () => void;
}

export interface PortSlot<T extends Observed> {
  /** The installed value, else the empty one. */
  readonly current: () => T;
  /** Install `next`; listeners hear it. Installing the one already installed does nothing. */
  readonly install: (next: T) => void;
  /** Uninstall `installed`, if it is still installed; whether it was. */
  readonly withdraw: (installed: T) => boolean;
  /** Listen for a change to the installed value, or to which one is installed. */
  readonly subscribe: (listener: () => void) => () => void;
}

export function portSlot<T extends Observed>(empty: T): PortSlot<T> {
  let installed = empty;
  let unsubscribe = empty.subscribe(tell);
  const listeners = new Set<{ readonly listener: () => void }>();

  function tell(): void {
    for (const { listener } of listeners) listener();
  }

  function swap(next: T): void {
    unsubscribe();
    installed = next;
    unsubscribe = next.subscribe(tell);
    tell();
  }

  return {
    current: () => installed,
    install: (next) => {
      if (installed !== next) swap(next);
    },
    withdraw: (value) => {
      if (installed !== value) return false;
      swap(empty);
      return true;
    },
    subscribe: (listener) => {
      const entry = { listener };
      listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    },
  };
}
