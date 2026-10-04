/**
 * The sdk's hooks: React readings of `BrowserHost`, each a statically known
 * hook over the host's subscribe and reads. A feature calls these, never a
 * store, and the host holds no hook of its own (see `sdk/host.ts`).
 */
import { useCallback, useContext, useSyncExternalStore } from "react";
import type { WireNode } from "@kb/contracts";
import type { KbIndex } from "./query";
import { OpenNodeContext, type Follow } from "./lib/follow";
import type { RefInk } from "./lib/md-edit";
import { usePane } from "./lib/pane";
import { usePaneScreenThrough, type PaneCarryOut, type PaneReport } from "./lib/pane-screen";
import type { SchemaIndex } from "./lib/schema";
import type { NodeMap, OutlineNode } from "./lib/types";
import { useQueryNodeRows, type QueryNodeRows } from "./lib/use-query-node-rows";
import type { Appearance, ThemePref } from "./lib/theme";
import { useNarrowViewport } from "./lib/viewport";
import { browserHost, type BrowserHost } from "./host";

/** What `read` answers of the host, re-read whenever the host changes. */
function useHostValue<T>(read: (host: BrowserHost) => T): T {
  const host = browserHost();
  const snapshot = () => read(host);
  return useSyncExternalStore(host.subscribe, snapshot, snapshot);
}

/** A node of the live graph; undefined for no id or no such node. */
export function useNode(id: string | undefined): OutlineNode | undefined {
  return useHostValue((host) => (id === undefined ? undefined : host.node(id)));
}

/** Every node of the live graph. */
export function useNodes(): NodeMap {
  return useHostValue((host) => host.nodes());
}

/** The live graph's schema. */
export function useSchema(): SchemaIndex {
  return useHostValue((host) => host.schema());
}

/** Whether a node is being edited in this instance. */
export function useIsActive(nodeId: string, instanceKey: string): boolean {
  return useHostValue((host) => host.isActive(nodeId, instanceKey));
}

/**
 * Report what this view shows for the pane it is drawn in, and carry out the
 * commands sent to it with `carryOut`, until it unmounts (`lib/pane-screen`).
 */
export function usePaneScreen(report: PaneReport, carryOut: PaneCarryOut): void {
  usePaneScreenThrough(browserHost().screen, report, carryOut);
}

/** The replica's index, or null before the graph has loaded. */
export function useIndex(): KbIndex | null {
  return useHostValue((host) => host.index());
}

/** The graph's nodes as they came over the wire. */
export function useWireNodes(): WireNode[] {
  return useHostValue((host) => host.wireNodes());
}

/** The index's mutation counter: it moves on every change the replica takes. */
export function useGeneration(): number {
  return useHostValue((host) => host.index()?.generation ?? 0);
}

/**
 * A query node's rows, live: a subscription while the socket is open, the
 * local index otherwise (`useQueryNodeRows`).
 */
export function useQueryRows(input: {
  readonly nodeId: string;
  readonly edn: string | null;
}): QueryNodeRows {
  const live = useHostValue((host) => host.live());
  const index = useIndex();
  const generation = useGeneration();
  return useQueryNodeRows({
    nodeId: input.nodeId,
    edn: input.edn,
    live,
    index,
    generation,
    subscribe: browserHost().subscribeQuery,
  });
}

/** How references in rendered text are inked, for `MdView`'s `ink`. */
export function useRefInk(): RefInk {
  return useHostValue((host) => host.refInk());
}

/** How a pointer in rendered text is followed from where the caller is drawn, for `MdView`'s `onFollow`. */
export function useFollow(): Follow {
  const open = useContext(OpenNodeContext);
  const pane = usePane();
  return useCallback<Follow>(
    (target, how) => browserHost().follow({ pane, open }, target, how),
    [open, pane],
  );
}

/** What the page is painted in, resolved. */
export function useAppearance(): Appearance {
  return useHostValue((host) => host.appearance());
}

export function useTheme(): ThemePref {
  return useHostValue((host) => host.theme());
}

/** Whether Preferences is open, and how to open or close it. */
export function usePrefsOpen(): readonly [boolean, (open: boolean) => void] {
  const open = useHostValue((host) => host.prefsOpen());
  return [open, (next) => browserHost().setPrefsOpen(next)];
}

/** The left rail's state and gesture, for the `SidebarToggle` primitive. */
export function useSidebarToggle(): {
  readonly open: boolean;
  readonly onToggle: (button: HTMLButtonElement | null) => void;
} {
  const narrow = useNarrowViewport();
  const open = useHostValue((host) => host.sidebarOpen(narrow));
  return { open, onToggle: (button) => browserHost().toggleSidebar(narrow, open, button) };
}
