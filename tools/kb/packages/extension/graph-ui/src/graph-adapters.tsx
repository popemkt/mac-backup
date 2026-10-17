import { lazy, useMemo } from "react";
import { outlineBulletAppearance, useNodes, useWireNodes, WorkspaceBoundary } from "@kb/ui-sdk";
import type { LensNode } from "./graph-lens";
import type { ParamsOf } from "@kb/views";
import {
  hopLabelsOf,
  relationOfEdge,
  type ClusterView,
  type Force2dView,
  type Force3dView,
  type LensEdge,
  type TreeView,
} from "@kb/graph";
import { useGraphTheme, type GraphTheme } from "./graph-themes";
import { SigmaGraph } from "./sigma-graph";
import { ClusterGraph } from "./cluster-graph";
import { TreeGraph } from "./tree-graph";
import type { GraphFrame } from "./graph-frame";
const Force3dGraph = lazy(() => import("./force3d-graph"));

/** What a renderer draws from: the settings it reads, and the frame its host extracted. */
export interface RendererProps<P> {
  readonly settings: P;
  readonly frame: GraphFrame;
}

export function Force2dAdapter({
  settings,
  frame: {
    lensGraph,
    layoutKey,
    appearance,
    searchHighlight,
    filterIds,
    selection,
    setSelection,
    setControls,
    onNodeOpen,
    trace,
  },
}: RendererProps<ParamsOf<typeof Force2dView>>) {
  const theme = useGraphTheme(settings.theme);
  const nodes = useOutlineBullets(lensGraph.nodes, theme);
  const edgeLabel = useEdgeLabels(settings.edgeLabels);
  return (
    <SigmaGraph
      nodes={nodes}
      edges={lensGraph.edges}
      layoutKey={layoutKey}
      appearance={appearance}
      layout={settings.layout}
      showLabels={settings.showLabels}
      labelDensity={settings.labelDensity}
      linkStyle={settings.linkStyle}
      theme={theme}
      onNodeOpen={onNodeOpen}
      onSelectionChange={setSelection}
      selectedNodeId={selection?.nodeId ?? null}
      onControlsReady={setControls}
      highlightIds={searchHighlight ?? undefined}
      filterIds={filterIds ?? undefined}
      traceIds={trace.lit ?? undefined}
      onTraceTo={trace.to}
      edgeLabel={edgeLabel}
    />
  );
}

export function TreeAdapter({
  settings,
  frame: {
    lensGraph,
    forest,
    viewKey,
    appearance,
    searchHighlight,
    filterIds,
    selection,
    setSelection,
    setControls,
  },
}: RendererProps<ParamsOf<typeof TreeView>>) {
  return (
    <TreeGraph
      forest={forest}
      viewKey={viewKey}
      edges={lensGraph.edges}
      showLabels={settings.showLabels}
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
  settings,
  frame: {
    lensGraph,
    layoutKey,
    appearance,
    searchHighlight,
    filterIds,
    selection,
    setSelection,
    setControls,
    onNodeOpen,
    trace,
  },
}: RendererProps<ParamsOf<typeof ClusterView>>) {
  const theme = useGraphTheme(settings.theme);
  const nodes = useOutlineBullets(lensGraph.nodes, theme);
  const edgeLabel = useEdgeLabels(settings.edgeLabels);
  return (
    <ClusterGraph
      nodes={nodes}
      edges={lensGraph.edges}
      layoutKey={layoutKey}
      appearance={appearance}
      onNodeClick={onNodeOpen}
      selectedNodeId={selection?.nodeId ?? null}
      onSelectionChange={setSelection}
      highlightIds={searchHighlight ?? undefined}
      filterIds={filterIds ?? undefined}
      traceIds={trace.lit ?? undefined}
      onTraceTo={trace.to}
      edgeLabel={edgeLabel}
      showLabels={settings.showLabels}
      labelDensity={settings.labelDensity}
      linkStyle={settings.linkStyle}
      theme={theme}
      onControlsReady={setControls}
    />
  );
}

/**
 * The lens's nodes, each carrying the bullet the page draws for its row —
 * read off the same row (the host's `useNodes`), its collapsed state included — when
 * the theme draws nodes as the page's rows; otherwise the nodes as they are,
 * so an edit that no drawn node shows redraws nothing.
 */
function useOutlineBullets(nodes: LensNode[], theme: GraphTheme): LensNode[] {
  const drawsBullets = theme.form === "bullet";
  const rows = useNodes();
  const outline = drawsBullets ? rows : null;
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
  settings,
  frame: {
    lensGraph,
    layoutKey,
    appearance,
    searchHighlight,
    filterIds,
    selection,
    setSelection,
    setControls,
    onNodeOpen,
  },
}: RendererProps<ParamsOf<typeof Force3dView>>) {
  const theme = useGraphTheme(settings.theme);
  const nodes = useOutlineBullets(lensGraph.nodes, theme);
  return (
    <WorkspaceBoundary title="Opening the third dimension…">
      <Force3dGraph
        nodes={nodes}
        edges={lensGraph.edges}
        layoutKey={layoutKey}
        appearance={appearance}
        onSelectionChange={setSelection}
        onNodeOpen={onNodeOpen}
        selectedNodeId={selection?.nodeId ?? null}
        onControlsReady={setControls}
        highlightIds={searchHighlight ?? undefined}
        filterIds={filterIds ?? undefined}
        spread={settings.spread}
        linkDistance={settings.linkDistance}
        autorotate={settings.autorotate}
        showLabels={settings.showLabels}
        theme={theme}
        linkStyle={settings.linkStyle}
        labelTopN={
          settings.labelDensity === "low" ? 12 : settings.labelDensity === "high" ? 48 : 24
        }
      />
    </WorkspaceBoundary>
  );
}

/**
 * Each link's label while `on`: its relation's (`@kb/graph`'s
 * `relationOfEdge`), a typed relation by its field node's text, read from
 * the page's nodes by the labels a trace's hops are worded with.
 */
function useEdgeLabels(on: boolean): ((edge: LensEdge) => string) | undefined {
  const wireNodes = useWireNodes();
  return useMemo(() => {
    if (!on) return undefined;
    const labels = hopLabelsOf(wireNodes);
    return (edge: LensEdge) => relationOfEdge(edge, labels).label;
  }, [on, wireNodes]);
}
