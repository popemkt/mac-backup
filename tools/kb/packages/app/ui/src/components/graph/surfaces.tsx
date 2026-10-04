import { lazy, use, useMemo } from "react";
import { GraphIcon } from "@phosphor-icons/react";
import {
  GraphView,
  type ClusterView,
  type Force2dView,
  type Force3dView,
  type GraphParams,
  type TreeView,
  type TreemapView,
  type ParamsOf,
} from "@kb/views";
import {
  graphPath,
  keptLoad,
  listPerspectiveNodes,
  navigate,
  NotFound,
  paramsOf,
  SidebarRow,
  SidebarSection,
  ViewErrorBoundary,
  type MatchedRoute,
  type ViewProps,
} from "@kb/ui-sdk";
import { listPerspectiveNavItems } from "@/lib/sidebar-nav";
import { useOutlineStore } from "@/stores/outline.store";

/** The renderers' chunk: sigma and graphology stay out of the outline's bundle. */
async function importRendererViews() {
  const { Force2dRenderer, TreeRenderer, ClusterRenderer, Force3dRenderer, TreemapRenderer } =
    await import("@/components/graph/renderer-views");
  return { Force2dRenderer, TreeRenderer, ClusterRenderer, Force3dRenderer, TreemapRenderer };
}
type RendererViews = Awaited<ReturnType<typeof importRendererViews>>;

/**
 * Loaded once and kept, so a renderer view renders at once whenever the chunk
 * has arrived; a failed load is forgotten, so the view's "Try again" loads it
 * again (`lib/kept-load`).
 */
const rendererViews = keptLoad(importRendererViews);

/**
 * The renderers' chunk: at once when it has arrived, else suspending inside
 * the renderer's own slot until it does, or throwing its failure to that slot.
 */
function useRendererViews(): RendererViews {
  return rendererViews.current() ?? use(rendererViews.load());
}

// Each renderer view as the graph plugin provides it: a component in this
// always-loaded file that draws the one in the renderers' chunk.

export function Force2dRendererView(props: ViewProps<ParamsOf<typeof Force2dView>>) {
  const { Force2dRenderer } = useRendererViews();
  return <Force2dRenderer {...props} />;
}

export function TreeRendererView(props: ViewProps<ParamsOf<typeof TreeView>>) {
  const { TreeRenderer } = useRendererViews();
  return <TreeRenderer {...props} />;
}

export function ClusterRendererView(props: ViewProps<ParamsOf<typeof ClusterView>>) {
  const { ClusterRenderer } = useRendererViews();
  return <ClusterRenderer {...props} />;
}

export function Force3dRendererView(props: ViewProps<ParamsOf<typeof Force3dView>>) {
  const { Force3dRenderer } = useRendererViews();
  return <Force3dRenderer {...props} />;
}

export function TreemapRendererView(props: ViewProps<ParamsOf<typeof TreemapView>>) {
  const { TreemapRenderer } = useRendererViews();
  return <TreemapRenderer {...props} />;
}

/** The page fetches the renderers with it, so its canvas never waits on a second round trip. */
const GraphPage = lazy(() => {
  // Fetch the renderers alongside the page, so its canvas seldom waits on a
  // second round trip; a failure here is the renderer slot's to show, not the
  // page's.
  rendererViews.load().catch(() => undefined);
  return import("@/components/graph/graph-page");
});

export function GraphSurface({ params }: ViewProps<GraphParams>) {
  const perspectiveId = params.perspective ?? null;
  const ontologyId = params.ontology ?? null;
  const wireNodes = useOutlineStore((s) => s.wireNodes);
  const index = useOutlineStore((s) => s.index);
  // Not missing while the index loads: the graphs are a query over it.
  const missing = useMemo(
    () =>
      perspectiveId !== null &&
      index !== null &&
      !listPerspectiveNodes(index, wireNodes).some((n) => n.id === perspectiveId),
    [index, wireNodes, perspectiveId],
  );
  if (missing)
    return (
      <NotFound
        what="Graph perspective"
        id={perspectiveId ?? undefined}
        back={{ label: "Graph", path: graphPath() }}
      />
    );
  return (
    <ViewErrorBoundary
      title="Graph crashed"
      resetKey={ontologyId === null ? (perspectiveId ?? "graph") : `o:${ontologyId}`}
    >
      <GraphPage perspectiveId={perspectiveId} ontologyId={ontologyId} />
    </ViewErrorBoundary>
  );
}

export function GraphSection({ route }: { readonly route: MatchedRoute | null }) {
  const wireNodes = useOutlineStore((s) => s.wireNodes);
  const index = useOutlineStore((s) => s.index);
  const perspectives = useMemo(() => listPerspectiveNavItems(index, wireNodes), [index, wireNodes]);
  const graph = paramsOf(route, GraphView);
  return (
    <SidebarSection>
      <SidebarRow
        label="Graph"
        icon={<GraphIcon size={14} />}
        active={graph !== null && graph.perspective === undefined}
        onClick={() => navigate(graphPath())}
      />
      {perspectives.map((p) => (
        <SidebarRow
          key={p.id}
          label={p.label}
          indented
          active={graph !== null && graph.perspective === p.id}
          onClick={() => navigate(graphPath(p.id))}
        />
      ))}
    </SidebarSection>
  );
}
