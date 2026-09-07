import { lazy } from "react";
import { SigmaGraph } from "./sigma-graph";
import { ClusterGraph } from "./cluster-graph";
import { TreeGraph } from "./tree-graph";
import { WorkspaceBoundary } from "@/components/ui/workspace-boundary";
const Force3dGraph = lazy(() => import("./force3d-graph"));

import type { GraphAdapterProps } from "./graph-renderers";

export function Force2dAdapter({
  lensGraph,
  active,
  themeKey,
  searchHighlight,
  filterIds,
  selection,
  setSelection,
  setControls,
  onNodeOpen,
}: GraphAdapterProps) {
  return (
    <SigmaGraph
      nodes={lensGraph.nodes}
      edges={lensGraph.edges}
      layoutKey={active.id}
      themeKey={themeKey}
      layout={active.layout}
      showLabels={active.showLabels}
      labelDensity={active.labelDensity}
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
  themeKey,
  searchHighlight,
  filterIds,
  selection,
  setSelection,
  setControls,
}: GraphAdapterProps) {
  return (
    <TreeGraph
      forest={forest}
      edges={lensGraph.edges}
      showLabels={active.showLabels}
      highlightIds={searchHighlight ?? undefined}
      filterIds={filterIds ?? undefined}
      themeKey={themeKey}
      selectedNodeId={selection?.nodeId ?? null}
      onSelectionChange={setSelection}
      onControlsReady={setControls}
    />
  );
}

export function ClusterAdapter({
  lensGraph,
  active,
  themeKey,
  searchHighlight,
  filterIds,
  selection,
  setSelection,
  setControls,
  onNodeOpen,
}: GraphAdapterProps) {
  return (
    <ClusterGraph
      nodes={lensGraph.nodes}
      edges={lensGraph.edges}
      layoutKey={active.id}
      themeKey={themeKey}
      onNodeClick={onNodeOpen}
      selectedNodeId={selection?.nodeId ?? null}
      onSelectionChange={setSelection}
      highlightIds={searchHighlight ?? undefined}
      filterIds={filterIds ?? undefined}
      showLabels={active.showLabels}
      labelDensity={active.labelDensity}
      onControlsReady={setControls}
    />
  );
}

export function Force3dAdapter({
  lensGraph,
  active,
  themeKey,
  searchHighlight,
  filterIds,
  selection,
  setSelection,
  setControls,
}: GraphAdapterProps) {
  return (
    <WorkspaceBoundary title="Opening the third dimension…">
      <Force3dGraph
        nodes={lensGraph.nodes}
        edges={lensGraph.edges}
        layoutKey={active.id}
        themeKey={themeKey}
        onSelectionChange={setSelection}
        selectedNodeId={selection?.nodeId ?? null}
        onControlsReady={setControls}
        highlightIds={searchHighlight ?? undefined}
        filterIds={filterIds ?? undefined}
        spread={active.spread}
        linkDistance={active.linkDistance}
        curvedLinks={active.curvedLinks}
        autorotate={active.autorotate}
        showLabels={active.showLabels}
        labelTopN={active.labelDensity === "low" ? 12 : active.labelDensity === "high" ? 48 : 24}
      />
    </WorkspaceBoundary>
  );
}
