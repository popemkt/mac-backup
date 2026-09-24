import { lazy } from "react";
import { FlaskIcon } from "@phosphor-icons/react";
import { LAB_SURFACE, labPath, labSceneOf } from "@/components/lab/routes";
import { SidebarRow, SidebarSection } from "@/components/ui/sidebar-row";
import { ViewErrorBoundary } from "@/components/view-error-boundary";
import type { MatchedRoute, SurfaceParams } from "@/lib/plugins";
import { navigate } from "@/lib/router";

/** Three.js and every scene stay in the lab's own chunks: the main bundle must not grow. */
const LabPage = lazy(() => import("@/components/lab/lab-page"));

export function LabSurface({ params }: { readonly params: SurfaceParams }) {
  const scene = labSceneOf(params);
  return (
    <ViewErrorBoundary title="Lab crashed" resetKey={scene}>
      <LabPage scene={scene} />
    </ViewErrorBoundary>
  );
}

export function LabSection({ route }: { readonly route: MatchedRoute }) {
  const active = route.surface === LAB_SURFACE;
  return (
    <SidebarSection>
      <SidebarRow
        label="Lab"
        icon={<FlaskIcon size={14} />}
        active={active}
        onClick={() => navigate(labPath(labSceneOf(active ? route.params : {})))}
      />
    </SidebarSection>
  );
}
