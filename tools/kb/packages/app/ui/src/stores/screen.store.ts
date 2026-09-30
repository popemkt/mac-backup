/**
 * The open view's part of this tab's screen. The tab publishes its screen
 * over `/ws` (`src/screen.ts`); the route and the view key it knows itself,
 * but what the view shows — the node it is shown for, its focus and
 * selection, a canvas's viewport — only the mounted view knows. So the view
 * reports that here, with how it carries out a `ui.select`, and takes both
 * back when it unmounts.
 */
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import type { CanvasScreen, ScreenAck } from "@kb/contracts";

/** What the view in the pane says about what it shows. */
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

interface ScreenStore {
  readonly report: PaneReport | null;
  readonly select: PaneSelect | null;
  /** Which mounted view the two belong to, so one view's unmount never clears another's. */
  readonly owner: symbol | null;
}

export const useScreenStore = create<ScreenStore>(() => ({
  report: null,
  select: null,
  owner: null,
}));

/**
 * Report `report` for the pane this view is mounted in, and carry out its
 * selects with `select`, until the view unmounts. A report equal to the last
 * one is not news.
 */
export function usePaneScreen(report: PaneReport, select: PaneSelect): void {
  const [owner] = useState(() => Symbol("pane-view"));
  const selectRef = useRef(select);

  useEffect(() => {
    selectRef.current = select;
    const now = useScreenStore.getState();
    if (now.owner === owner && JSON.stringify(now.report) === JSON.stringify(report)) return;
    useScreenStore.setState({ report, select: (command) => selectRef.current(command), owner });
  });

  useEffect(
    () => () => {
      if (useScreenStore.getState().owner === owner) {
        useScreenStore.setState({ report: null, select: null, owner: null });
      }
    },
    [owner],
  );
}
