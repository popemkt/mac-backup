/**
 * The workspace: the layout open as the whole screen (DESIGN-UI.md → Panes
 * and layouts). One pane is drawn on its own, with no chrome, exactly as the
 * page always was; two or more are a movable layout grid. Each pane's body is
 * drawn once, here, and only placed by whichever of the two is showing, so
 * opening or closing a pane never remounts another.
 */
import { lazy, Suspense } from "react";
import { layoutPanes, type LayoutPane } from "@kb/views";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { PaneFrame } from "./pane-frame";
import { PaneMount } from "./pane-mount";
import { usePaneBodies } from "./use-pane-bodies";

const LayoutGrid = lazy(() => import("./layout-grid"));

const drawPane = (pane: LayoutPane) => <PaneFrame path={pane.path} />;

export function Workspace() {
  const layout = useWorkspaceStore((s) => s.layout);
  const focused = useWorkspaceStore((s) => s.focused);
  const focus = useWorkspaceStore((s) => s.focus);
  const arrange = useWorkspaceStore((s) => s.arrange);
  const close = useWorkspaceStore((s) => s.close);
  const navigatePane = useWorkspaceStore((s) => s.navigatePane);
  const panes = layoutPanes(layout);
  const { elementOf, bodies } = usePaneBodies(panes, drawPane, focus);
  const [only] = panes;
  return (
    <>
      {bodies}
      {only !== undefined && panes.length === 1 ? (
        <PaneMount element={elementOf(only.id)} />
      ) : (
        <Suspense fallback={<PaneMount element={elementOf(focused)} />}>
          <LayoutGrid
            tree={layout}
            focused={focused}
            elementOf={elementOf}
            movable
            onFocus={focus}
            onArrange={arrange}
            onClose={close}
            onNavigate={navigatePane}
          />
        </Suspense>
      )}
    </>
  );
}
