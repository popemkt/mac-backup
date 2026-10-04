import { lazy } from "react";
import { FlaskIcon } from "@phosphor-icons/react";
import { labPath } from "./routes";
import { LAB_SCENE_IDS, LabView, type LabParams } from "@kb/lab";
import {
  navigate,
  paramsOf,
  SidebarRow,
  SidebarSection,
  ViewErrorBoundary,
  type MatchedRoute,
  type ViewProps,
} from "@kb/ui-sdk";

/** Three.js and every scene stay in the lab's own chunks: the main bundle must not grow. */
const LabPage = lazy(() => import("./lab-page"));

export function LabSurface({ params }: ViewProps<LabParams>) {
  const { scene } = params;
  return (
    <ViewErrorBoundary title="Lab crashed" resetKey={scene}>
      <LabPage scene={scene} />
    </ViewErrorBoundary>
  );
}

export function LabSection({ route }: { readonly route: MatchedRoute | null }) {
  const lab = paramsOf(route, LabView);
  return (
    <SidebarSection>
      <SidebarRow
        label="Lab"
        icon={<FlaskIcon size={14} />}
        active={lab !== null}
        onClick={() => navigate(labPath(lab?.scene ?? LAB_SCENE_IDS[0]))}
      />
    </SidebarSection>
  );
}
