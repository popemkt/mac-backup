import { useMemo } from "react";
import { HouseIcon, PushPinIcon } from "@phosphor-icons/react";
import { OutlineColumn } from "@/components/outline/outline-column";
import { useOutlineScreen } from "@/components/outline/use-outline-screen";
import { OutlineView, type OutlineParams } from "@kb/views";
import {
  navigate,
  nodePath,
  OpenNodeContext,
  paramsOf,
  SidebarRow,
  SidebarSection,
  usePane,
  ViewErrorBoundary,
  type MatchedRoute,
  type ViewProps,
} from "@kb/ui-sdk";
import { listPinnedNavItems } from "@/lib/sidebar-nav";
import { useOutlineStore } from "@/stores/outline.store";
import { useWorkspaceStore } from "@/stores/workspace.store";

/**
 * The outline: at its `root` when it has one (a node opened in a pane), else
 * at the outline's zoom. A rooted outline opens a node by moving its pane to
 * it; the zoomed one zooms. The zoom is the store's, one per tab, so two panes
 * at `/` show the same node. GAP [[01M411FP5AGQ4VB5SGJWCJAN66]]
 */
export function OutlineSurface({ params }: ViewProps<OutlineParams>) {
  const zoomRoot = useOutlineStore((s) => s.rootNodeId);
  const { root } = params;
  const pane = usePane();
  const navigatePane = useWorkspaceStore((s) => s.navigatePane);
  const open = useMemo(
    () => (root === undefined ? null : (id: string) => navigatePane(pane, nodePath(id))),
    [root, pane, navigatePane],
  );
  useOutlineScreen(root);
  return (
    <OpenNodeContext.Provider value={open}>
      <ViewErrorBoundary title="Outline crashed" resetKey={root ?? zoomRoot}>
        <OutlineColumn root={root} />
      </ViewErrorBoundary>
    </OpenNodeContext.Provider>
  );
}

export function HomeSection({ route }: { readonly route: MatchedRoute | null }) {
  const zoomHome = useOutlineStore((s) => s.zoomHome);
  const rootNodeId = useOutlineStore((s) => s.rootNodeId);
  const homeRootId = useOutlineStore((s) => s.homeRootId);
  return (
    <SidebarSection>
      <SidebarRow
        label="Home"
        icon={<HouseIcon size={14} />}
        active={paramsOf(route, OutlineView) !== null && rootNodeId === homeRootId}
        onClick={() => {
          navigate("/");
          zoomHome();
        }}
      />
    </SidebarSection>
  );
}

export function PinnedSection({ route }: { readonly route: MatchedRoute | null }) {
  const nodes = useOutlineStore((s) => s.nodes);
  const zoomTo = useOutlineStore((s) => s.zoomTo);
  const rootNodeId = useOutlineStore((s) => s.rootNodeId);
  const pinned = useMemo(() => listPinnedNavItems(nodes), [nodes]);
  const onOutline = paramsOf(route, OutlineView) !== null;
  return (
    <SidebarSection title="Pinned">
      {pinned.length === 0 ? (
        <p className="px-2 py-1 text-label text-foreground/30">Pin nodes with ⌘K</p>
      ) : (
        pinned.map((f) => (
          <SidebarRow
            key={f.id}
            label={f.label}
            icon={<PushPinIcon size={14} />}
            active={onOutline && rootNodeId === f.id}
            onClick={() => {
              navigate("/");
              zoomTo(f.id);
            }}
          />
        ))
      )}
    </SidebarSection>
  );
}
