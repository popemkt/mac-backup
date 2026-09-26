/**
 * The lab page: one study, full frame, under a thin header, with the study's
 * info card over it. This module and everything below it load only when
 * `/lab` is opened, and each study's three.js code loads only when that
 * study is shown.
 */
import { useCallback, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { useReducedMotion } from "@/lib/motion";
import { navigate } from "@/lib/router";
import { useOutlineStore } from "@/stores/outline.store";
import { useAppearance, usePrefsStore, useSidebarToggle } from "@/stores/prefs.store";
import { useUiStore } from "@/stores/ui.store";
import { SidebarToggle } from "@/components/ui/sidebar-toggle";
import { ThemeIcon } from "@/components/ui/theme-icon";
import { WorkspaceState } from "@/components/ui/workspace-state";
import { initialValues, type LabControlValue, type LabHover } from "@/components/lab/kit/contract";
import { InfoCard } from "@/components/lab/kit/info-card";
import type { SceneBackend } from "@/scene/backend";
import { SceneHost } from "@/components/lab/kit/scene-host";
import { readTiming } from "@/lib/timing";
import { useLabGraph } from "@/components/lab/lab-graph";
import { labPath } from "@/components/lab/routes";
import { LAB_SCENE_IDS, type LabSceneId } from "@/components/lab/views";
import { LAB_STUDIES } from "@/components/lab/studies";

function StudySwitch({ scene }: { scene: LabSceneId }) {
  return (
    <div className="flex items-center gap-0.5" role="group" aria-label="Study">
      {LAB_SCENE_IDS.map((id) => (
        <button
          key={id}
          type="button"
          aria-pressed={id === scene}
          className={cn(
            "flex h-6 items-center rounded-md px-2 text-meta transition-colors duration-100",
            id === scene
              ? "bg-foreground/[0.08] text-foreground/80"
              : "text-foreground/45 hover:bg-foreground/[0.05] hover:text-foreground/70",
          )}
          onClick={() => navigate(labPath(id))}
        >
          {LAB_STUDIES[id].label}
        </button>
      ))}
    </div>
  );
}

function LabHeader({ scene, backend }: { scene: LabSceneId; backend: SceneBackend | null }) {
  const sidebar = useSidebarToggle();
  const theme = usePrefsStore((s) => s.theme);
  const prefsOpen = useUiStore((s) => s.prefsOpen);
  const setPrefsOpen = useUiStore((s) => s.setPrefsOpen);
  return (
    <header className="relative z-10 flex h-11 shrink-0 items-center gap-3 px-4">
      <SidebarToggle {...sidebar} />
      <span className="text-ui font-medium text-foreground/50">lab</span>
      <StudySwitch scene={scene} />
      {backend === null ? null : <span className="text-label text-foreground/35">{backend}</span>}
      <div className="flex-1" />
      <button
        type="button"
        className="flex h-6 w-6 items-center justify-center rounded-md text-foreground/40 transition-colors duration-100 hover:bg-foreground/5 hover:text-foreground/70"
        aria-label="Preferences"
        title="Preferences"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setPrefsOpen(!prefsOpen)}
      >
        <ThemeIcon theme={theme} size={15} />
      </button>
    </header>
  );
}

function HoverLabel({ hover }: { hover: LabHover }) {
  return (
    <div
      className="pointer-events-none absolute z-10 max-w-64 -translate-x-1/2 truncate rounded-md border border-foreground/10 bg-popover/90 px-2 py-1 text-meta text-foreground/80 shadow-lifted backdrop-blur-sm"
      style={{ left: hover.x, top: hover.y + 14 }}
    >
      {hover.label}
    </div>
  );
}

/** One open study: its scene, its card, its values. Remounted per study. */
function Study({
  scene,
  onBackend,
}: {
  scene: LabSceneId;
  onBackend: (b: SceneBackend | null) => void;
}) {
  const study = LAB_STUDIES[scene];
  const graph = useLabGraph();
  const appearance = useAppearance();
  const reducedMotion = useReducedMotion();
  const zoomTo = useOutlineStore((s) => s.zoomTo);
  const timing = useMemo(() => readTiming(), []);
  const [values, setValues] = useState(() => initialValues(study.controls));
  const [hover, setHover] = useState<LabHover | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onChange = useCallback(
    (id: string, value: LabControlValue) => setValues((current) => ({ ...current, [id]: value })),
    [],
  );
  const onOpen = useCallback(
    (id: string) => {
      navigate("/");
      zoomTo(id);
    },
    [zoomTo],
  );
  const { Panel } = study;
  return (
    <div className="absolute inset-0 bg-[var(--lab-ground)]" data-lab-study={scene}>
      {error === null ? (
        <SceneHost
          study={study}
          graph={graph}
          appearance={appearance}
          reducedMotion={reducedMotion}
          values={values}
          onHover={setHover}
          onOpen={onOpen}
          onReady={onBackend}
          onError={setError}
        />
      ) : (
        <WorkspaceState title="This study could not start" description={error} />
      )}
      <div className="pointer-events-none absolute inset-x-4 bottom-4 z-10 flex items-end justify-between gap-4">
        <InfoCard study={study} values={values} onChange={onChange} />
        {Panel === undefined ? null : (
          <Panel key={appearance.key} values={values} timing={timing} />
        )}
      </div>
      {hover === null ? null : <HoverLabel hover={hover} />}
    </div>
  );
}

export default function LabPage({ scene }: { scene: LabSceneId }) {
  const [backend, setBackend] = useState<SceneBackend | null>(null);
  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[var(--lab-ground)]">
      <LabHeader scene={scene} backend={backend} />
      <div className="absolute inset-0">
        <Study key={scene} scene={scene} onBackend={setBackend} />
      </div>
    </div>
  );
}
