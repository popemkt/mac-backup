import { lazy, useMemo } from "react";
import { outlineBulletAppearance } from "@/lib/bullet-mode";
import type { LensNode, LensTheme } from "@/lib/graph-lens";
import type { ParamsOf } from "@/lib/plugins";
import { GRAPH_THEMES } from "./graph-themes";
import { useOutlineStore } from "@/stores/outline.store";
import { SigmaGraph } from "./sigma-graph";
import { ClusterGraph } from "./cluster-graph";
import { TreeGraph } from "./tree-graph";
import { WorkspaceBoundary } from "@/components/ui/workspace-boundary";
import type { GraphFrame } from "./graph-frame";
import type { ClusterView, Force2dView, Force3dView, TreeView } from "./views";
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
  },
}: RendererProps<ParamsOf<typeof Force2dView>>) {
  const nodes = useOutlineBullets(lensGraph.nodes, settings.theme);
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
      theme={settings.theme}
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
  },
}: RendererProps<ParamsOf<typeof ClusterView>>) {
  const nodes = useOutlineBullets(lensGraph.nodes, settings.theme);
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
      showLabels={settings.showLabels}
      labelDensity={settings.labelDensity}
      linkStyle={settings.linkStyle}
      theme={settings.theme}
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
  const nodes = useOutlineBullets(lensGraph.nodes, settings.theme);
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
        theme={settings.theme}
        linkStyle={settings.linkStyle}
        labelTopN={
          settings.labelDensity === "low" ? 12 : settings.labelDensity === "high" ? 48 : 24
        }
      />
    </WorkspaceBoundary>
  );
}
