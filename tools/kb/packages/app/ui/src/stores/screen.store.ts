/**
 * The open views' part of this tab's screen. The tab publishes its screen
 * over `/ws` (`src/screen.ts`); each pane's location and view key it knows
 * itself, but what a view shows — the node it is shown for, its focus and
 * selection, a canvas's camera — only the mounted view knows. So each view
 * reports that here, under the pane it is drawn in (`lib/pane`), with how it
 * carries out a `ui.select`, and takes both back when it unmounts. The shapes
 * and the reporting hook are `lib/pane-screen`'s; this is where reports are held.
 */
import { create } from "zustand";
import {
  usePaneScreenThrough,
  type PaneReport,
  type PaneScreenPort,
  type PaneSelect,
} from "@kb/ui-sdk";

/** One pane's view: what it reports and how it selects. */
interface PaneView {
  readonly report: PaneReport;
  readonly select: PaneSelect;
  /** Which mounted view the two belong to, so one view's unmount never clears another's. */
  readonly owner: symbol;
}

interface ScreenStore {
  /** By pane id; a pane whose view reports nothing has no entry. */
  readonly panes: Readonly<Record<string, PaneView>>;
}

export const useScreenStore = create<ScreenStore>(() => ({ panes: {} }));

/** `panes` without `pane`'s entry. */
function without(panes: Readonly<Record<string, PaneView>>, pane: string) {
  const { [pane]: _gone, ...rest } = panes;
  return rest;
}

/** The screen store as the place pane reports are held. */
export const paneScreenPort: PaneScreenPort = {
  report: (pane, owner, report, select) => {
    const now = useScreenStore.getState().panes[pane];
    if (now?.owner === owner && JSON.stringify(now.report) === JSON.stringify(report)) return;
    useScreenStore.setState((state) => ({
      panes: { ...state.panes, [pane]: { report, select, owner } },
    }));
  },
  release: (pane, owner) => {
    if (useScreenStore.getState().panes[pane]?.owner === owner) {
      useScreenStore.setState((state) => ({ panes: without(state.panes, pane) }));
    }
  },
};

/**
 * Report `report` for the pane this view is drawn in, and carry out its
 * selects with `select`, until the view unmounts. A report equal to the last
 * one is not news.
 */
export function usePaneScreen(report: PaneReport, select: PaneSelect): void {
  usePaneScreenThrough(paneScreenPort, report, select);
}
