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
} from "@/components/graph/views";
import { NotFound } from "@/components/ui/not-found";
import { SidebarRow, SidebarSection } from "@/components/ui/sidebar-row";
import { ViewErrorBoundary } from "@/components/view-error-boundary";
import { isGraphPerspectiveNode } from "@/lib/graph-lens";
import { paramsOf, type MatchedRoute, type ViewProps } from "@/lib/plugins";
import type { ParamsOf } from "@/lib/view-key";
import { graphPath, navigate } from "@/lib/router";
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
 * The chunk is loaded once and kept, so a renderer view renders at once
 * whenever it has already arrived. A load that fails is forgotten, so the next
 * render (a retry from the view's error) asks again.
 */
let rendererViews: RendererViews | null = null;
let rendererViewsLoading: Promise<RendererViews> | null = null;
function loadRendererViews(): Promise<RendererViews> {
  rendererViewsLoading ??= importRendererViews().then(
    (views) => {
      rendererViews = views;
      return views;
    },
    (error: unknown) => {
      rendererViewsLoading = null;
      throw error;
    },
  );
  return rendererViewsLoading;
}

/** The renderers' chunk: at once when it has arrived, else suspending until it does. */
function useRendererViews(): RendererViews {
  return rendererViews ?? use(loadRendererViews());
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
const GraphPage = lazy(async () => {
  const [page] = await Promise.all([import("@/components/graph/graph-page"), loadRendererViews()]);
  return page;
});

export function GraphSurface({ params }: ViewProps<GraphParams>) {
  const perspectiveId = params.perspective ?? null;
  const ontologyId = params.ontology ?? null;
  const wireNodes = useOutlineStore((s) => s.wireNodes);
  const missing = useMemo(
    () =>
      perspectiveId !== null &&
      !wireNodes.some((n) => n.id === perspectiveId && isGraphPerspectiveNode(n)),
    [wireNodes, perspectiveId],
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
  const perspectives = useMemo(() => listPerspectiveNavItems(wireNodes), [wireNodes]);
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
