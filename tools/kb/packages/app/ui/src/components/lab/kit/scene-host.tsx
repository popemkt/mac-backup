/**
 * Mounts one study's scene into a div and keeps it in step with React:
 * graph, theme, reduced motion, control values, size and tab visibility go
 * in through the scene's handle, and unmounting (a study switch, leaving the
 * page, the plugin being unloaded) disposes it — every GPU resource, loop and
 * listener with it.
 */
import { useEffect, useRef, useState } from "react";
import type {
  LabBackend,
  LabControlValues,
  LabHover,
  LabScene,
  LabStudy,
} from "@/components/lab/kit/contract";
import { readLabPalette } from "@/components/lab/kit/palette";
import { readTiming } from "@/components/lab/kit/timing";
import type { LabGraph } from "@/components/lab/lab-graph";

export interface SceneHostProps {
  readonly study: LabStudy;
  readonly graph: LabGraph;
  /** The theme; the palette is re-read from the tokens whenever it flips. */
  readonly dark: boolean;
  readonly reducedMotion: boolean;
  readonly values: LabControlValues;
  readonly onHover: (hover: LabHover | null) => void;
  readonly onOpen: (id: string) => void;
  /** The scene is on screen, drawn by this backend. */
  readonly onReady: (backend: LabBackend) => void;
  /** The scene could not start (no WebGPU and no WebGL2, or a shader error). */
  readonly onError: (message: string) => void;
}

function visible(): boolean {
  return document.visibilityState !== "hidden";
}

/**
 * Mount the study while this effect lives, and hand the mounted scene out
 * through `onMounted`; the latest props come through `live`.
 */
function useMountedScene(
  host: React.RefObject<HTMLDivElement | null>,
  live: React.RefObject<SceneHostProps>,
  study: LabStudy,
  onMounted: (scene: LabScene | null) => void,
): void {
  useEffect(() => {
    const el = host.current;
    if (el === null) return undefined;
    let gone = false;
    let mounted: LabScene | null = null;
    const start = async () => {
      const mount = await study.load();
      const props = live.current;
      const next = await mount(el, {
        graph: props.graph,
        palette: readLabPalette(),
        timing: readTiming(),
        dark: props.dark,
        reducedMotion: props.reducedMotion,
        values: props.values,
        onHover: (hover) => live.current.onHover(hover),
        onOpen: (id) => live.current.onOpen(id),
      });
      if (gone) {
        next.dispose();
        return;
      }
      mounted = next;
      next.resize(el.clientWidth, el.clientHeight);
      next.setRunning(visible());
      onMounted(next);
      live.current.onReady(next.backend);
    };
    start().catch((error: unknown) => {
      if (!gone) live.current.onError(error instanceof Error ? error.message : String(error));
    });
    const resize = new ResizeObserver(() => mounted?.resize(el.clientWidth, el.clientHeight));
    resize.observe(el);
    const onVisibility = () => mounted?.setRunning(visible());
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      gone = true;
      resize.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      mounted?.dispose();
      onMounted(null);
    };
  }, [host, live, study, onMounted]);
}

/** Hand each changed control value to the scene, once. */
function useControlValues(scene: LabScene | null, values: LabControlValues): void {
  const sent = useRef<LabControlValues>(values);
  useEffect(() => {
    if (scene === null) return;
    for (const [id, value] of Object.entries(values)) {
      if (sent.current[id] !== value) scene.setControl(id, value);
    }
    sent.current = values;
  }, [scene, values]);
}

export function SceneHost(props: SceneHostProps) {
  const { study, graph, dark, reducedMotion, values } = props;
  const host = useRef<HTMLDivElement>(null);
  const live = useRef(props);
  useEffect(() => {
    live.current = props;
  });
  const [scene, setScene] = useState<LabScene | null>(null);
  useMountedScene(host, live, study, setScene);
  useControlValues(scene, values);
  useEffect(() => scene?.setGraph?.(graph), [scene, graph]);
  // By the time this runs the `.dark` class has moved, so the tokens are the new theme's.
  useEffect(() => scene?.setPalette(readLabPalette(), dark), [scene, dark]);
  useEffect(() => scene?.setReducedMotion(reducedMotion), [scene, reducedMotion]);
  return <div ref={host} className="absolute inset-0" data-testid="lab-scene" />;
}
