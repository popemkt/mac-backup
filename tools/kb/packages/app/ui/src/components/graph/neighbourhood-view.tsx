import { useCallback, useMemo, useState } from "react";
import { Result } from "effect";
import { buildTreeForest, navigate, ViewSlot, WorkspaceState, type ViewProps } from "@kb/ui-sdk";
import { extractNeighbourhood } from "@/lib/graph-neighbourhood";
import { paramsFrom, type NeighbourhoodParams } from "@kb/views";
import { useAppearance } from "@/stores/prefs.store";
import { useOutlineStore } from "@/stores/outline.store";
import { GraphFrameContext, type GraphFrame } from "./graph-frame";
import { selectionFromNode, type GraphSelection } from "./graph-selection";
import { useRenderer } from "./use-renderers";

const EMPTY = { nodes: [], edges: [], dropped: 0, queryError: null };

/**
 * A node's neighbourhood, drawn by a renderer view: the host of that
 * renderer, the way the graph page is the host of the whole graph. It
 * extracts the neighbourhood (`extractNeighbourhood`), hands it to the
 * renderer in a `GraphFrame`, and draws the renderer through a slot filling
 * its own box, for its root, so a neighbourhood shown inside another stops
 * at the first repeat.
 */
export function NeighbourhoodGraph({ params }: ViewProps<NeighbourhoodParams>) {
  const { root, hops, edges, renderer, settings } = params;
  const wireNodes = useOutlineStore((s) => s.wireNodes);
  const index = useOutlineStore((s) => s.index);
  const zoomTo = useOutlineStore((s) => s.zoomTo);
  const appearance = useAppearance();
  const rendererKey = useRenderer(renderer);

  const lensGraph = useMemo(
    () => (index === null ? EMPTY : extractNeighbourhood(index, wireNodes, { root, hops, edges })),
    [index, wireNodes, root, hops, edges],
  );
  const forest = useMemo(
    () => buildTreeForest(lensGraph.nodes, lensGraph.edges, root),
    [lensGraph, root],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = lensGraph.nodes.find((node) => node.id === selectedId);
  const selection = selected === undefined ? null : selectionFromNode(selected);
  const setSelection = useCallback(
    (value: GraphSelection | null) => setSelectedId(value?.nodeId ?? null),
    [],
  );
  const onNodeOpen = useCallback(
    (id: string) => {
      navigate("/");
      zoomTo(id);
    },
    [zoomTo],
  );
  const layoutKey = `neighbourhood:${root}:${hops}`;
  const frame = useMemo(
    (): GraphFrame => ({
      lensGraph,
      forest,
      layoutKey,
      viewKey: [layoutKey, edges.join(",")].join("\n"),
      appearance,
      searchHighlight: null,
      filterIds: null,
      selection,
      setSelection,
      setControls: () => undefined,
      onNodeOpen,
    }),
    [lensGraph, forest, layoutKey, edges, appearance, selection, setSelection, onNodeOpen],
  );

  const drawn = rendererKey === null ? null : paramsFrom(rendererKey, settings);
  const unavailable = (
    <WorkspaceState
      title="Neighbourhood unavailable"
      description={
        drawn !== null && Result.isFailure(drawn)
          ? `${renderer} cannot draw these settings: ${drawn.failure}`
          : `No renderer is registered for ${renderer}.`
      }
    />
  );
  if (lensGraph.nodes.length === 0)
    return (
      <WorkspaceState
        title="Nothing to draw"
        description="This node's neighbourhood holds no nodes the graph shows."
      />
    );
  return (
    <div className="relative h-full min-h-40 w-full" data-neighbourhood-root={root}>
      {rendererKey !== null && drawn !== null && Result.isSuccess(drawn) ? (
        <GraphFrameContext.Provider value={frame}>
          <ViewSlot
            view={rendererKey}
            params={drawn.success}
            placement="page"
            fallback={unavailable}
            subject={root}
          />
        </GraphFrameContext.Provider>
      ) : (
        unavailable
      )}
    </div>
  );
}
