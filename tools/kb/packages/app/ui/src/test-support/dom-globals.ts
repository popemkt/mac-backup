/**
 * A happy-dom window installed on the globals React and the store read, and
 * taken back off again.
 *
 * The suite shares one process, so the globals a file installs are the globals
 * the next file inherits — a synchronous `requestAnimationFrame` left behind by
 * one suite silently changes how another one's store callbacks run. Restoring
 * what was there before is what keeps a DOM-driven test file local.
 */
import { Window } from "happy-dom";

/** The global names a DOM-driven UI test needs on `globalThis`. */
const KEYS = [
  "window",
  "document",
  "HTMLElement",
  "KeyboardEvent",
  "MouseEvent",
  "Node",
  "CSS",
  "requestAnimationFrame",
] as const;

export interface InstalledDom {
  window: Window;
  /** Put every global back the way it was found. */
  restore: () => void;
}

/**
 * Install a fresh window on the globals. `requestAnimationFrame` runs its
 * callback inline: store choreography that schedules a scroll must be observable
 * in the same tick a test asserts in.
 */
export function installDomGlobals(url = "http://localhost/"): InstalledDom {
  const g = globalThis as Record<string, unknown>;
  const saved = new Map<string, { present: boolean; value: unknown }>();
  for (const key of KEYS) saved.set(key, { present: key in g, value: g[key] });

  const dom = new Window({ url });
  g.window = dom;
  g.document = dom.document;
  g.HTMLElement = dom.HTMLElement;
  g.KeyboardEvent = dom.KeyboardEvent;
  g.MouseEvent = dom.MouseEvent;
  g.Node = dom.Node;
  g.CSS = { escape: (s: string) => s };
  g.requestAnimationFrame = (cb: (t: number) => void) => {
    cb(0);
    return 0;
  };

  return {
    window: dom,
    restore: () => {
      for (const [key, before] of saved) {
        if (before.present) g[key] = before.value;
        else delete g[key];
      }
    },
  };
}
