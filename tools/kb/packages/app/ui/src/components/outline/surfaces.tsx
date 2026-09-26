import { useMemo } from "react";
import { HouseIcon, PushPinIcon } from "@phosphor-icons/react";
import { OutlineColumn } from "@/components/outline/outline-column";
import { OutlineView } from "@/components/outline/views";
import { SidebarRow, SidebarSection } from "@/components/ui/sidebar-row";
import { ViewErrorBoundary } from "@/components/view-error-boundary";
import { paramsOf, type MatchedRoute } from "@/lib/plugins";
import { navigate } from "@/lib/router";
import { listPinnedNavItems } from "@/lib/sidebar-nav";
import { useOutlineStore } from "@/stores/outline.store";

export function OutlineSurface() {
  const rootNodeId = useOutlineStore((s) => s.rootNodeId);
  return (
    <ViewErrorBoundary title="Outline crashed" resetKey={rootNodeId}>
      <OutlineColumn />
    </ViewErrorBoundary>
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
