// One-shot classes: add a class for one animation, take it off when the
// animation ends (or after a deadline, if it never starts: an effect switched
// off mid-flight, a detached element). Never restarts a running pulse, since
// restarting a CSS animation needs a forced layout.

export interface Pulser {
  /** Add `className` (and `attributes`) to `element` for one animation; false if it is already pulsing. */
  pulse(element: Element, className: string, deadlineMs: number, attributes?: Readonly<Record<string, string>>): boolean;
  /** How many elements carry `className` right now. */
  running(className: string): number;
  /** Take every class and attribute off now. */
  clear(): void;
}

interface Running {
  readonly className: string;
  readonly attributes: ReadonlyArray<string>;
  readonly stop: () => void;
}

export function createPulser(win: Window): Pulser {
  const live = new Map<Element, Array<Running>>();

  const finish = (element: Element, entry: Running) => {
    entry.stop();
    element.classList.remove(entry.className);
    for (const name of entry.attributes) element.removeAttribute(name);
    const rest = (live.get(element) ?? []).filter((other) => other !== entry);
    if (rest.length === 0) live.delete(element);
    else live.set(element, rest);
  };

  return {
    pulse: (element, className, deadlineMs, attributes = {}) => {
      if (element.classList.contains(className)) return false;
      for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
      element.classList.add(className);
      const onEnd = (event: Event) => {
        // A child's animation bubbles here too; only the element's own counts.
        // A pseudo-element's (::after) animation reports the element itself as target.
        if (event.target === element) finish(element, entry);
      };
      const timer = win.setTimeout(() => finish(element, entry), deadlineMs);
      const entry: Running = {
        className,
        attributes: Object.keys(attributes),
        stop: () => {
          win.clearTimeout(timer);
          element.removeEventListener("animationend", onEnd);
        },
      };
      element.addEventListener("animationend", onEnd);
      live.set(element, [...(live.get(element) ?? []), entry]);
      return true;
    },
    running: (className) => {
      let count = 0;
      for (const entries of live.values()) count += entries.filter((entry) => entry.className === className).length;
      return count;
    },
    clear: () => {
      // Map iteration tolerates the deletes `finish` makes.
      for (const [element, entries] of live) for (const entry of entries) finish(element, entry);
    },
  };
}
