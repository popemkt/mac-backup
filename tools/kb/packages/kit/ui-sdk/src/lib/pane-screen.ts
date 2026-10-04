/**
 * A view's report of what it shows, for the pane it is drawn in (`lib/pane`),
 * and how it carries out a `ui.select`. The tab's screen is assembled from
 * these (`stores/screen.store`, `src/screen.ts`). This module holds the shapes
 * and the one hook that reports through a port, so the screen store and the
 * page's `BrowserHost` are two bindings of one body.
 */
import { useEffect, useRef, useState } from "react";
import type { CanvasScreen, ScreenAck } from "@kb/contracts";
import { usePane } from "./pane";

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

/** Where pane reports are held. */
export interface PaneScreenPort {
  /**
   * Hold `report` for `pane` under `owner`, carrying out its selects with
   * `select`. A report equal to the one `owner` already holds is not news.
   */
  readonly report: (pane: string, owner: symbol, report: PaneReport, select: PaneSelect) => void;
  /** Let `pane`'s report go, if `owner` still holds it. */
  readonly release: (pane: string, owner: symbol) => void;
}

/**
 * Report `report` for the pane this view is drawn in, through `port`, and
 * carry out its selects with `select`, until the view unmounts.
 */
export function usePaneScreenThrough(
  port: PaneScreenPort,
  report: PaneReport,
  select: PaneSelect,
): void {
  const pane = usePane();
  const [owner] = useState(() => Symbol("pane-view"));
  const selectRef = useRef(select);

  useEffect(() => {
    selectRef.current = select;
    port.report(pane, owner, report, (command) => selectRef.current(command));
  });

  useEffect(() => () => port.release(pane, owner), [owner, pane, port]);
}
