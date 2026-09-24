import { lazy, useMemo, useState } from "react";
import { PlusIcon, SquareIcon } from "@phosphor-icons/react";
import { CANVAS_LIST_SURFACE, CANVAS_SURFACE } from "@/components/canvas/routes";
import { SidebarRow, SidebarSection } from "@/components/ui/sidebar-row";
import { ViewErrorBoundary } from "@/components/view-error-boundary";
import { createCanvasNode } from "@/lib/canvas-api";
import type { MatchedRoute, SurfaceParams } from "@/lib/plugins";
import { navigate } from "@/lib/router";
import { listCanvasNavItems } from "@/lib/sidebar-nav";
import { useOutlineStore } from "@/stores/outline.store";

const CanvasListPage = lazy(() =>
  import("@/components/canvas/canvas-list-page").then((m) => ({ default: m.CanvasListPage })),
);
const CanvasPage = lazy(() =>
  import("@/components/canvas/canvas-page").then((m) => ({ default: m.CanvasPage })),
);

export function CanvasListSurface() {
  return (
    <ViewErrorBoundary title="Canvas crashed" resetKey="canvas-list">
      <CanvasListPage />
    </ViewErrorBoundary>
  );
}

export function CanvasSurface({ params }: { readonly params: SurfaceParams }) {
  const id = params["id"] ?? "";
  return (
    <ViewErrorBoundary title="Canvas crashed" resetKey={id}>
      <CanvasPage canvasId={id} />
    </ViewErrorBoundary>
  );
}

export function CanvasSection({ route }: { readonly route: MatchedRoute }) {
  const nodes = useOutlineStore((s) => s.nodes);
  const canvases = useMemo(() => listCanvasNavItems(nodes), [nodes]);
  const [creating, setCreating] = useState(false);
  const onNew = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const id = await createCanvasNode();
      if (id !== null) navigate(`/canvas/${id}`);
    } finally {
      setCreating(false);
    }
  };
  return (
    <SidebarSection>
      <SidebarRow
        label="Canvases"
        icon={<SquareIcon size={14} />}
        active={route.surface === CANVAS_LIST_SURFACE}
        onClick={() => navigate("/canvas")}
      />
      {canvases.map((c) => (
        <SidebarRow
          key={c.id}
          label={c.label}
          indented
          active={route.surface === CANVAS_SURFACE && route.params["id"] === c.id}
          onClick={() => navigate(`/canvas/${c.id}`)}
        />
      ))}
      <SidebarRow
        label={creating ? "Creating…" : "New canvas"}
        icon={<PlusIcon size={14} />}
        indented
        muted
        onClick={() => void onNew()}
      />
    </SidebarSection>
  );
}
