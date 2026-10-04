import { lazy, useMemo, useState } from "react";
import { PlusIcon, SquareIcon } from "@phosphor-icons/react";
import { CanvasListView, CanvasView, type CanvasParams } from "@kb/views";
import {
  navigate,
  paramsOf,
  SidebarRow,
  SidebarSection,
  useNodes,
  ViewErrorBoundary,
  type MatchedRoute,
  type ViewProps,
} from "@kb/ui-sdk";
import { createCanvasNode, listCanvasNavItems } from "./canvas-api";

const CanvasListPage = lazy(() =>
  import("./canvas-list-page").then((m) => ({ default: m.CanvasListPage })),
);
const CanvasPage = lazy(() => import("./canvas-page").then((m) => ({ default: m.CanvasPage })));

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
  const nodes = useNodes();
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
