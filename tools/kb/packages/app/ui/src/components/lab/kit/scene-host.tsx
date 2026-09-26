/**
 * The lab's React host over the scene host (`@/scene/host`): it mounts one
 * study's scene into a div through `attachScene`, which owns sizing, tab
 * visibility and disposal, and hands the study what only a study is told —
 * graph, theme, reduced motion and control values.
 */
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { LabControlValues, LabHover, LabScene, LabStudy } from "@/components/lab/kit/contract";
import { readLabPalette } from "@/components/lab/kit/palette";
import type { SceneBackend } from "@/scene/backend";
import { attachScene } from "@/scene/host";
import { readTiming } from "@/lib/timing";
import type { LabGraph } from "@/components/lab/lab-graph";
import type { Appearance } from "@/stores/prefs.store";

export interface SceneHostProps {
  readonly study: LabStudy;
  readonly graph: LabGraph;
  /** The palette is re-read from the tokens whenever the appearance changes. */
  readonly appearance: Appearance;
  readonly reducedMotion: boolean;
  readonly values: LabControlValues;
  readonly onHover: (hover: LabHover | null) => void;
  readonly onOpen: (id: string) => void;
  /** The scene is on screen, drawn by this backend. */
  readonly onReady: (backend: SceneBackend) => void;
  /** The scene could not start (no WebGPU and no WebGL2, or a shader error). */
  readonly onError: (message: string) => void;
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
  const { study, graph, appearance, reducedMotion, values } = props;
  const host = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<LabScene | null>(null);
  // The scene reports through these, and a mount starts from the latest props.
  const hovered = useEffectEvent((hover: LabHover | null) => props.onHover(hover));
  const opened = useEffectEvent((id: string) => props.onOpen(id));
  const initOf = useEffectEvent(() => ({
    graph: props.graph,
    palette: readLabPalette(),
    timing: readTiming(),
    dark: props.appearance.dark,
    reducedMotion: props.reducedMotion,
    values: props.values,
    onHover: hovered,
    onOpen: opened,
  }));
  const ready = useEffectEvent((next: LabScene) => {
    setScene(next);
    props.onReady(next.backend);
  });
  const failed = useEffectEvent((error: Error) => props.onError(error.message));

  useEffect(() => {
    const el = host.current;
    if (el === null) return undefined;
    const init = initOf();
    const mounting = study.load().then((mount) => mount(el, init));
    const detach = attachScene(el, mounting, { onReady: ready, onError: failed });
    return () => {
      detach();
      setScene(null);
    };
  }, [study]);
  useControlValues(scene, values);
  useEffect(() => scene?.setGraph?.(graph), [scene, graph]);
  // By the time this runs <html> carries the new appearance, so the tokens hold its values.
  // `appearance` is a new object exactly when its key changes.
  useEffect(() => scene?.setPalette(readLabPalette(), appearance.dark), [scene, appearance]);
  useEffect(() => scene?.setReducedMotion(reducedMotion), [scene, reducedMotion]);
  return <div ref={host} className="absolute inset-0" data-testid="lab-scene" />;
}
