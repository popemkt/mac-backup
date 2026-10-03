/**
 * The sdk's hooks: React readings of `BrowserHost`, each a statically known
 * hook over the host's subscribe and reads. A feature calls these, never a
 * store, and the host holds no hook of its own (see `sdk/host.ts`).
 */
import { useCallback, useContext, useSyncExternalStore } from "react";
import type { KbNode } from "@kb/model";
import { OpenNodeContext, type Follow } from "@/lib/follow";
import type { RefInk } from "@/lib/md-edit";
import { usePane } from "@/lib/pane";
import { useQueryNodeRows, type QueryNodeRows } from "@/lib/use-query-node-rows";
import type { Appearance } from "@/lib/theme";
import { browserHost, type BrowserHost } from "./host";

/** What `read` answers of the host, re-read whenever the host changes. */
function useHostValue<T>(read: (host: BrowserHost) => T): T {
  const host = browserHost();
  const snapshot = () => read(host);
  return useSyncExternalStore(host.subscribe, snapshot, snapshot);
}

/** A node of the live graph; undefined for no id or no such node. */
export function useNode(id: string | undefined): KbNode | undefined {
  return useHostValue((host) => (id === undefined ? undefined : host.node(id)));
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
  const index = useHostValue((host) => host.index());
  const generation = useGeneration();
  return useQueryNodeRows({ nodeId: input.nodeId, edn: input.edn, live, index, generation });
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
