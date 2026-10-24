// The selector canary: how many elements each host selector matches now, and
// whether it has matched anything since the layer mounted. A host upgrade that
// renames an attribute shows up as a selector that never matches, instead of
// an effect that quietly stopped. Counting is querySelectorAll only: no layout.

export interface CanaryEntry {
  readonly id: string;
  readonly selector: string;
}

export interface CanaryReading<E extends CanaryEntry> {
  readonly entry: E;
  /** Matches in the document right now. */
  readonly now: number;
  /** Whether it matched at least once since the canary started. */
  readonly seen: boolean;
}

export interface Canary<E extends CanaryEntry> {
  /** Count every selector now, and remember which have matched. */
  read(): ReadonlyArray<CanaryReading<E>>;
  dispose(): void;
}

/** Match counts, treating an invalid selector as matching nothing. */
function count(doc: Document, selector: string): number {
  try {
    return doc.querySelectorAll(selector).length;
  } catch {
    return 0;
  }
}

export function createCanary<E extends CanaryEntry>(
  win: Window,
  entries: ReadonlyArray<E>,
  sampleMs = 3000,
): Canary<E> {
  const seen = new Set<string>();
  let disposed = false;
  let timer: ReturnType<Window["setTimeout"]> | undefined;

  const read = () =>
    entries.map((entry) => {
      const now = count(win.document, entry.selector);
      if (now > 0) seen.add(entry.id);
      return { entry, now, seen: seen.has(entry.id) };
    });
  const tick = () => {
    if (disposed) return;
    read();
    timer = win.setTimeout(tick, sampleMs);
  };
  tick();

  return {
    read,
    dispose: () => {
      disposed = true;
      if (timer !== undefined) win.clearTimeout(timer);
    },
  };
}
