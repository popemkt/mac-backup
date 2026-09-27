import { lazy, useMemo } from "react";
import { outlineBulletAppearance } from "@/lib/bullet-mode";
import type { LensNode, LensTheme } from "@/lib/graph-lens";
import { GRAPH_THEMES } from "./graph-themes";
import { useOutlineStore } from "@/stores/outline.store";
import { SigmaGraph } from "./sigma-graph";
import { ClusterGraph } from "./cluster-graph";
import { TreeGraph } from "./tree-graph";
import { WorkspaceBoundary } from "@/components/ui/workspace-boundary";
const Force3dGraph = lazy(() => import("./force3d-graph"));

import type { GraphAdapterProps } from "./graph-renderers";

export function Force2dAdapter({
  lensGraph,
  active,
  appearance,
  searchHighlight,
  filterIds,
  selection,
  setSelection,
  setControls,
  onNodeOpen,
}: GraphAdapterProps) {
  const nodes = useOutlineBullets(lensGraph.nodes, active.theme);
  return (
    <SigmaGraph
      nodes={nodes}
      edges={lensGraph.edges}
      layoutKey={active.id}
      appearance={appearance}
      layout={active.layout}
      showLabels={active.showLabels}
      labelDensity={active.labelDensity}
      linkStyle={active.linkStyle}
      theme={active.theme}
      onNodeOpen={onNodeOpen}
      onSelectionChange={setSelection}
      selectedNodeId={selection?.nodeId ?? null}
      onControlsReady={setControls}
      highlightIds={searchHighlight ?? undefined}
      filterIds={filterIds ?? undefined}
    />
  );
}

export function TreeAdapter({
  lensGraph,
  active,
  forest,
  viewKey,
  appearance,
  searchHighlight,
  filterIds,
  selection,
  setSelection,
  setControls,
}: GraphAdapterProps) {
  return (
    <TreeGraph
      forest={forest}
      viewKey={viewKey}
      edges={lensGraph.edges}
      showLabels={active.showLabels}
      highlightIds={searchHighlight ?? undefined}
      filterIds={filterIds ?? undefined}
      appearance={appearance}
      selectedNodeId={selection?.nodeId ?? null}
      onSelectionChange={setSelection}
      onControlsReady={setControls}
    />
  );
}

export function ClusterAdapter({
  lensGraph,
  active,
  appearance,
  searchHighlight,
  filterIds,
  selection,
  setSelection,
  setControls,
  onNodeOpen,
}: GraphAdapterProps) {
  const nodes = useOutlineBullets(lensGraph.nodes, active.theme);
  return (
    <ClusterGraph
      nodes={nodes}
      edges={lensGraph.edges}
      layoutKey={active.id}
      appearance={appearance}
      onNodeClick={onNodeOpen}
      selectedNodeId={selection?.nodeId ?? null}
      onSelectionChange={setSelection}
      highlightIds={searchHighlight ?? undefined}
      filterIds={filterIds ?? undefined}
      showLabels={active.showLabels}
      labelDensity={active.labelDensity}
      linkStyle={active.linkStyle}
      theme={active.theme}
      onControlsReady={setControls}
    />
  );
}

/**
 * The lens's nodes, each carrying the bullet the outline draws for it — read
 * off the same outline node, its collapsed state included — when the theme
 * draws nodes as the outline does; otherwise the nodes as they are, so an
 * outline edit that no drawn node shows redraws nothing.
 */
function useOutlineBullets(nodes: LensNode[], theme: LensTheme): LensNode[] {
  const drawsBullets = GRAPH_THEMES[theme].form === "bullet";
  const outline = useOutlineStore((s) => (drawsBullets ? s.nodes : null));
  return useMemo(
    () =>
      outline === null
        ? nodes
        : nodes.map((node) => {
            const row = outline.get(node.id);
            return row === undefined ? node : { ...node, bullet: outlineBulletAppearance(row) };
          }),
    [nodes, outline],
  );
}

export function Force3dAdapter({
  lensGraph,
  active,
  appearance,
  searchHighlight,
  filterIds,
  selection,
  setSelection,
  setControls,
  onNodeOpen,
}: GraphAdapterProps) {
  const nodes = useOutlineBullets(lensGraph.nodes, active.theme);
  return (
    <WorkspaceBoundary title="Opening the third dimension…">
      <Force3dGraph
        nodes={nodes}
        edges={lensGraph.edges}
        layoutKey={active.id}
        appearance={appearance}
        onSelectionChange={setSelection}
        onNodeOpen={onNodeOpen}
        selectedNodeId={selection?.nodeId ?? null}
        onControlsReady={setControls}
        highlightIds={searchHighlight ?? undefined}
        filterIds={filterIds ?? undefined}
        spread={active.spread}
        linkDistance={active.linkDistance}
        autorotate={active.autorotate}
        showLabels={active.showLabels}
        theme={active.theme}
        linkStyle={active.linkStyle}
        labelTopN={active.labelDensity === "low" ? 12 : active.labelDensity === "high" ? 48 : 24}
      />
    </WorkspaceBoundary>
  );
}
