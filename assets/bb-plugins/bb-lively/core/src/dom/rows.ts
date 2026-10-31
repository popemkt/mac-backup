// Which rows of a virtualized list just arrived, as opposed to rows that
// scrolled back into view or a whole list swapped for another (a thread
// switch). It reads attributes only, never layout:
//
// - every row id is remembered once seen, per list, so a remount on scroll
//   never animates again;
// - a row counts as arriving only past the highest index seen, so scrolling
//   up to older rows does nothing;
// - when no row the list held before is left, the list was swapped (another
//   thread, a jump): everything in it is taken as already there;
// - more than MAX_FRESH unseen rows at once is a jump too, not arrivals;
// - nothing arrives within USER_SCROLL_QUIET_MS of the person scrolling
//   (wheel, touch, scroll keys), unless they just sent a message.
//
// One MutationObserver per list (childList, no subtree); lists are found by a
// cheap periodic query rather than by observing the whole document.
import type { Targets } from "./targets.ts";

const MAX_FRESH = 4;
const USER_SCROLL_QUIET_MS = 500;
const SEND_WINDOW_MS = 2500;
const SCAN_MS = 1000;
const SCROLL_KEYS = new Set(["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", " "]);

export interface RowWatcher {
  /** A local send happened: rows in the next moment are its echo, even mid-scroll. */
  armSend(): void;
  /** Look for new lists now (also runs every second). */
  scan(): void;
  dispose(): void;
}

interface ListState {
  readonly observer: MutationObserver;
  readonly seen: Set<string>;
  maxIndex: number;
}

export function createRowWatcher(options: {
  readonly win: Window;
  readonly targets: Targets;
  /**
   * Rows that arrived, oldest first, and rows that are new nodes for a place the list already had
   * (`rekeyed`: the host swapped a row for another at the same index, or one scrolled back into
   * view). The caller decides which actually animate.
   */
  readonly onArrive: (rows: ReadonlyArray<Element>, rekeyed: ReadonlyArray<Element>) => void;
}): RowWatcher {
  const { win, targets, onArrive } = options;
  const doc = win.document;
  const lists = new Map<Element, ListState>();
  let lastUserScroll = Number.NEGATIVE_INFINITY;
  let sendUntil = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<Window["setTimeout"]> | undefined;
  let disposed = false;
  const now = () => win.performance.now();

  const rowsOf = (list: Element) => [...list.children].filter((child) => child.matches(targets.row));
  const idOf = (row: Element) => row.getAttribute(targets.rowIdAttribute);
  const indexOf = (row: Element) => {
    const raw = Number(row.getAttribute(targets.rowIndexAttribute));
    return Number.isFinite(raw) ? raw : Number.NEGATIVE_INFINITY;
  };
  const maxIndexOf = (rows: ReadonlyArray<Element>) => Math.max(Number.NEGATIVE_INFINITY, ...rows.map(indexOf));

  const changed = (list: Element, state: ListState) => {
    const present = rowsOf(list);
    const fresh = present.filter((row) => {
      const id = idOf(row);
      return id !== null && !state.seen.has(id);
    });
    if (fresh.length === 0) return;
    const kept = present.length - fresh.length;
    for (const row of fresh) state.seen.add(idOf(row) ?? "");
    if (kept === 0 || fresh.length > MAX_FRESH) {
      // Swapped or jumped: the new rows are the list's state, not arrivals.
      state.maxIndex = maxIndexOf(present);
      return;
    }
    const arriving = fresh.filter((row) => indexOf(row) > state.maxIndex).toSorted((a, b) => indexOf(a) - indexOf(b));
    const rekeyed = fresh.filter((row) => !arriving.includes(row));
    state.maxIndex = Math.max(state.maxIndex, maxIndexOf(fresh));
    const scrolling = now() - lastUserScroll < USER_SCROLL_QUIET_MS && now() > sendUntil;
    if ((arriving.length > 0 && !scrolling) || rekeyed.length > 0) onArrive(scrolling ? [] : arriving, rekeyed);
  };

  const scan = () => {
    for (const [list, state] of lists) {
      if (list.isConnected) continue;
      state.observer.disconnect();
      lists.delete(list);
    }
    for (const list of doc.querySelectorAll(targets.rowList)) {
      if (lists.has(list)) continue;
      const rows = rowsOf(list);
      const state: ListState = {
        observer: new (win as Window & typeof globalThis).MutationObserver(() => changed(list, state)),
        seen: new Set(rows.map(idOf).filter((id): id is string => id !== null)),
        maxIndex: maxIndexOf(rows),
      };
      state.observer.observe(list, { childList: true });
      lists.set(list, state);
    }
  };

  const tick = () => {
    if (disposed) return;
    scan();
    timer = win.setTimeout(tick, SCAN_MS);
  };

  const userScrolled = () => {
    lastUserScroll = now();
  };
  const keyScrolled = (event: KeyboardEvent) => {
    if (SCROLL_KEYS.has(event.key)) userScrolled();
  };
  const listenerOptions = { capture: true, passive: true } as const;
  win.addEventListener("wheel", userScrolled, listenerOptions);
  win.addEventListener("touchmove", userScrolled, listenerOptions);
  win.addEventListener("keydown", keyScrolled, listenerOptions);
  tick();

  return {
    armSend: () => {
      sendUntil = now() + SEND_WINDOW_MS;
    },
    scan,
    dispose: () => {
      disposed = true;
      if (timer !== undefined) win.clearTimeout(timer);
      for (const state of lists.values()) state.observer.disconnect();
      lists.clear();
      win.removeEventListener("wheel", userScrolled, listenerOptions);
      win.removeEventListener("touchmove", userScrolled, listenerOptions);
      win.removeEventListener("keydown", keyScrolled, listenerOptions);
    },
  };
}
