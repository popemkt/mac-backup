/**
 * The page as the shell reads it: the rows of the projection it stands in,
 * over the graph store's snapshot, and one subscription to everything those
 * rows and the editor's focus follow — the graph, the projection and the
 * editor, whichever are installed.
 */
import { useSyncExternalStore } from "react";
import type { NodeMap } from "@kb/ui-sdk";
import { pageProjection, subscribeProjection, useGraphStore } from "@/stores/graph.store";
import { subscribeEditor } from "@/stores/page-editor";

/** Listen for a change to the graph, the page's projection, or its editor. */
export function subscribePage(listener: () => void): () => void {
  const offs = [
    useGraphStore.subscribe(listener),
    subscribeProjection(listener),
    subscribeEditor(listener),
  ];
  return () => {
    for (const off of offs) off();
  };
}

/** The rows the page is shown and edited through now: its projection's rows of this graph. */
export function pageRows(): NodeMap {
  return pageProjection().rows(useGraphStore.getState());
}

/** The page's rows, read by this component: it re-renders when they change. */
export function usePageRows(): NodeMap {
  return useSyncExternalStore(subscribePage, pageRows, pageRows);
}
