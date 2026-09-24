import { lazy, useMemo } from "react";
import { GraphIcon } from "@phosphor-icons/react";
import { GRAPH_SURFACE } from "@/components/graph/routes";
import { SidebarRow, SidebarSection } from "@/components/ui/sidebar-row";
import { ViewErrorBoundary } from "@/components/view-error-boundary";
import type { MatchedRoute, SurfaceParams } from "@/lib/plugins";
import { graphPath, navigate } from "@/lib/router";
import { listPerspectiveNavItems } from "@/lib/sidebar-nav";
import { useOutlineStore } from "@/stores/outline.store";

/** Sigma and graphology stay in their own chunk: the outline bundle must not grow. */
const GraphPage = lazy(() => import("@/components/graph/graph-page"));

export function GraphSurface({ params }: { readonly params: SurfaceParams }) {
  const perspectiveId = params["perspective"] ?? null;
  const ontologyId = params["ontology"] ?? null;
  return (
    <ViewErrorBoundary
      title="Graph crashed"
      resetKey={ontologyId === null ? (perspectiveId ?? "graph") : `o:${ontologyId}`}
    >
      <GraphPage perspectiveId={perspectiveId} ontologyId={ontologyId} />
    </ViewErrorBoundary>
  );
}

export function GraphSection({ route }: { readonly route: MatchedRoute }) {
  const wireNodes = useOutlineStore((s) => s.wireNodes);
  const perspectives = useMemo(() => listPerspectiveNavItems(wireNodes), [wireNodes]);
  const onGraph = route.surface === GRAPH_SURFACE;
  return (
    <SidebarSection>
      <SidebarRow
        label="Graph"
        icon={<GraphIcon size={14} />}
        active={onGraph && route.params["perspective"] === undefined}
        onClick={() => navigate(graphPath())}
      />
      {perspectives.map((p) => (
        <SidebarRow
          key={p.id}
          label={p.label}
          indented
          active={onGraph && route.params["perspective"] === p.id}
          onClick={() => navigate(graphPath(p.id))}
        />
      ))}
    </SidebarSection>
  );
}
