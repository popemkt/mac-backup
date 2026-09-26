import { lazy, useMemo, useState } from "react";
import { PlusIcon, SquareIcon } from "@phosphor-icons/react";
import { CanvasListView, CanvasView, type CanvasParams } from "@/components/canvas/views";
import { SidebarRow, SidebarSection } from "@/components/ui/sidebar-row";
import { ViewErrorBoundary } from "@/components/view-error-boundary";
import { createCanvasNode } from "@/lib/canvas-api";
import { paramsOf, type MatchedRoute, type ViewProps } from "@/lib/plugins";
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

export function CanvasSurface({ params }: ViewProps<CanvasParams>) {
  const { id } = params;
  return (
    <ViewErrorBoundary title="Canvas crashed" resetKey={id}>
      <CanvasPage canvasId={id} />
    </ViewErrorBoundary>
  );
}

export function CanvasSection({ route }: { readonly route: MatchedRoute | null }) {
  const open = paramsOf(route, CanvasView);
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
        active={paramsOf(route, CanvasListView) !== null}
        onClick={() => navigate("/canvas")}
      />
      {canvases.map((c) => (
        <SidebarRow
          key={c.id}
          label={c.label}
          indented
          active={open?.id === c.id}
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
