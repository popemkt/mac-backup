/**
 * The open views' part of this tab's screen. The tab publishes its screen
 * over `/ws` (`src/screen.ts`); each pane's location and view key it knows
 * itself, but what a view shows — the node it is shown for, its focus and
 * selection, a canvas's viewport — only the mounted view knows. So each view
 * reports that here, under the pane it is drawn in (`lib/pane`), with how it
 * carries out a `ui.select`, and takes both back when it unmounts.
 */
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import type { CanvasScreen, ScreenAck } from "@kb/contracts";
import { usePane } from "@/lib/pane";

/** What the view in a pane says about what it shows. */
export interface PaneReport {
  /** The node the view is shown for (the outline's zoom root, the canvas node). */
  readonly subject?: string;
  readonly focused: string | null;
  /** In the view's own ids: node ids in the outline, item ids on a canvas. */
  readonly selection: readonly string[];
  readonly canvas?: CanvasScreen;
}

/** A `ui.select` as the view receives it. */
export interface PaneSelection {
  readonly selection?: readonly string[];
  readonly focus?: string;
}

/** How the view carries out a select; its answer is the tab's answer. */
export type PaneSelect = (command: PaneSelection) => ScreenAck;

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

/**
 * Report `report` for the pane this view is drawn in, and carry out its
 * selects with `select`, until the view unmounts. A report equal to the last
 * one is not news.
 */
export function usePaneScreen(report: PaneReport, select: PaneSelect): void {
  const pane = usePane();
  const [owner] = useState(() => Symbol("pane-view"));
  const selectRef = useRef(select);

  useEffect(() => {
    selectRef.current = select;
    const now = useScreenStore.getState().panes[pane];
    if (now?.owner === owner && JSON.stringify(now.report) === JSON.stringify(report)) return;
    useScreenStore.setState((state) => ({
      panes: {
        ...state.panes,
        [pane]: { report, select: (command) => selectRef.current(command), owner },
      },
    }));
  });

  useEffect(
    () => () => {
      if (useScreenStore.getState().panes[pane]?.owner === owner) {
        useScreenStore.setState((state) => ({ panes: without(state.panes, pane) }));
      }
    },
    [owner, pane],
  );
}
