/**
 * A view's report of what it shows, for the pane it is drawn in (`lib/pane`),
 * and how it carries out the screen commands sent to it. The tab's screen is
 * assembled from these (`stores/screen.store`, `src/screen.ts`). This module
 * holds the shapes and the one hook that reports through a port, so the
 * screen store and the page's `BrowserHost` are two bindings of one body.
 */
import { useEffect, useRef, useState } from "react";
import type { CanvasScreen, CanvasViewTarget, ScreenAck } from "@kb/contracts";
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

/**
 * A screen command as the view in its pane receives it: the commands the
 * view, not the tab, carries out — a `ui.select`, and the camera target of
 * a `ui.navigate` (`look`), which a view with no camera refuses.
 */
export type PaneCommand =
  | ({ readonly kind: "select" } & PaneSelection)
  | { readonly kind: "look"; readonly target: CanvasViewTarget };

/**
 * How the view carries out the commands sent to it; its answer, now or once
 * it has one, is the tab's answer. A command it has no way to carry out it
 * answers with a rejection that says so.
 */
export type PaneCarryOut = (command: PaneCommand) => ScreenAck | Promise<ScreenAck>;

/** Where pane reports are held. */
export interface PaneScreenPort {
  /**
   * Hold `report` for `pane` under `owner`, carrying out its commands with
   * `carryOut`. A report equal to the one `owner` already holds is not news.
   */
  readonly report: (
    pane: string,
    owner: symbol,
    report: PaneReport,
    carryOut: PaneCarryOut,
  ) => void;
  /** Let `pane`'s report go, if `owner` still holds it. */
  readonly release: (pane: string, owner: symbol) => void;
}

/**
 * Report `report` for the pane this view is drawn in, through `port`, and
 * carry out its commands with `carryOut`, until the view unmounts.
 */
export function usePaneScreenThrough(
  port: PaneScreenPort,
  report: PaneReport,
  carryOut: PaneCarryOut,
): void {
  const pane = usePane();
  const [owner] = useState(() => Symbol("pane-view"));
  const carryOutRef = useRef(carryOut);

  useEffect(() => {
    carryOutRef.current = carryOut;
    port.report(pane, owner, report, (command) => carryOutRef.current(command));
  });

  useEffect(() => () => port.release(pane, owner), [owner, pane, port]);
}
