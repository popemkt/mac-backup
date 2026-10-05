/**
 * Where a node text host reads and acts (`NodeTextHost`): the graph its
 * references and read-only reason resolve against, the caret hand-off
 * between instances, the registry of mounted text hosts, and the gestures it
 * makes. This module holds the port and the one hook that binds a host
 * through it, so the shell's stores (`stores/node-text-port.ts`) and the
 * page's `BrowserHost` are two bindings of one body.
 *
 * The text's writes are not here: which node a surface's text belongs to is
 * the surface's to say (`shownNodeId`), so it passes `onChange`,
 * `onAttachFile` and `onRemoveTag` itself.
 */
import { useSyncExternalStore } from "react";
import { useFollowThrough, type CarryOutFollow } from "../lib/follow";
import { useGraphReadThrough, type GraphSource } from "../lib/graph-read";
import type { CaretAt, CaretIntent, NodeTextHostBinding } from "./node-text-host";

export interface NodeTextPort extends GraphSource {
  /** The caret placement addressed to `instanceKey`, if one is pending. */
  readonly pendingCaret: (instanceKey: string) => CaretIntent | null;
  /** Ask the text host mounted in `instanceKey` to place its caret, if it is the active one. */
  readonly placeCaret: (instanceKey: string, at: CaretAt) => void;
  /** Take the placement addressed to `instanceKey`, leaving none pending. */
  readonly consumeCaret: (instanceKey: string) => CaretIntent | null;
  /** Say a text host is mounted in `instanceKey`, so the caret may be handed to it. */
  readonly registerTextHost: (instanceKey: string) => void;
  /** Say it is gone; the active node falls back when no host takes its place. */
  readonly unregisterTextHost: (instanceKey: string) => void;
  /** Select a node in one instance. */
  readonly selectNode: (nodeId: string, instanceKey?: string) => void;
  /** Open or close the node palette. */
  readonly setNodePaletteOpen: (open: boolean) => void;
  /** Carry out a follow from where its caller is drawn (`useFollowThrough`). */
  readonly follow: CarryOutFollow;
}

/**
 * A text host's binding in `instanceKey`, through `port`. The graph is read
 * through a tracked read (`lib/graph-read`), so the host re-renders when a
 * node it read changes, and the caret placement only when it is addressed to
 * `instanceKey`.
 */
export function useNodeTextBindingThrough(
  port: NodeTextPort,
  instanceKey: string | undefined,
): NodeTextHostBinding {
  const { outline, schema } = useGraphReadThrough(port);
  const caret = () => (instanceKey === undefined ? null : port.pendingCaret(instanceKey));
  const pendingCaret = useSyncExternalStore(port.subscribe, caret, caret);
  const onFollow = useFollowThrough(port.follow);
  return {
    nodes: outline,
    schema,
    pendingCaret,
    onFollow,
    consumeCaret: port.consumeCaret,
    placeCaret: port.placeCaret,
    selectNode: port.selectNode,
    registerTextHost: port.registerTextHost,
    unregisterTextHost: port.unregisterTextHost,
    setNodePaletteOpen: port.setNodePaletteOpen,
  };
}
