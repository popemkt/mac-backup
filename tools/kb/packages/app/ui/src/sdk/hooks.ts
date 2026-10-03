/**
 * The sdk's hooks: React readings of `BrowserHost`, each a statically known
 * hook over the host's subscribe and reads. A feature calls these, never a
 * store, and the host holds no hook of its own (see `sdk/host.ts`).
 */
import { useSyncExternalStore } from "react";
import type { KbNode } from "@kb/model";
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
function useGeneration(): number {
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

/** What the page is painted in, resolved. */
export function useAppearance(): Appearance {
  return useHostValue((host) => host.appearance());
}
