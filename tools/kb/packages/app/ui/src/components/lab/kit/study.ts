/**
 * `mountStudy`: the one way a study becomes a `LabScene` (Lab principles P4).
 *
 * A study supplies only what is its own — how it builds its scene, what a
 * frame does, what a control changes. Everything every study must get right
 * the same way lives here once: the stage, the reveal (P2), the theme hand-
 * off, and the reduced-motion rule (M7) — under reduced motion the loop is
 * off and the study is drawn once per change, a still composition.
 */
import type { LabControlValue, LabScene, LabSceneInit } from "@/components/lab/kit/contract";
import type { LabGraph } from "@/components/lab/lab-graph";
import type { LabPalette } from "@/components/lab/kit/palette";
import { createStage, type LabStage, type StageOptions } from "@/components/lab/kit/stage";

export interface StudyContext {
  /** The element the study draws into; its pointer events are the study's. */
  readonly host: HTMLElement;
  /** Whether motion is reduced right now (it can change while mounted). */
  readonly reduced: () => boolean;
}

export interface StudyParts {
  /** Advance by `dt` seconds (clamped); under reduced motion `dt` is 0. */
  readonly frame: (dt: number, elapsed: number) => void;
  readonly setControl: (id: string, value: LabControlValue) => void;
  /** After the stage has taken the new palette: re-tint what the stage does not own. */
  readonly setPalette?: (palette: LabPalette, dark: boolean) => void;
  readonly setGraph?: (graph: LabGraph) => void;
  /** Release what the stage's scene traversal does not reach (listeners, textures). */
  readonly dispose?: () => void;
}

type StudyOptions = Omit<StageOptions, "frame" | "palette" | "timing">;

export async function mountStudy(
  host: HTMLElement,
  init: LabSceneInit,
  options: StudyOptions,
  build: (stage: LabStage, init: LabSceneInit, context: StudyContext) => StudyParts,
): Promise<LabScene> {
  let parts: StudyParts | null = null;
  let reduced = init.reducedMotion;
  let running = false;
  const stage = await createStage(host, {
    ...options,
    palette: init.palette,
    timing: init.timing,
    frame: (dt, elapsed) => parts?.frame(reduced ? 0 : dt, elapsed),
  });
  const study = build(stage, init, { host, reduced: () => reduced });
  parts = study;
  study.setPalette?.(init.palette, init.dark);
  const apply = () => {
    stage.setRunning(running && !reduced);
    stage.invalidate();
  };
  await stage.reveal();
  const setGraph = study.setGraph;
  return {
    backend: stage.backend,
    ...(setGraph === undefined
      ? {}
      : {
          setGraph: (graph: LabGraph) => {
            setGraph(graph);
            stage.invalidate();
          },
        }),
    setPalette: (palette, dark) => {
      stage.setPalette(palette);
      study.setPalette?.(palette, dark);
      stage.invalidate();
    },
    setReducedMotion: (next) => {
      reduced = next;
      apply();
    },
    setControl: (id, value) => {
      study.setControl(id, value);
      stage.invalidate();
    },
    resize: (width, height) => stage.resize(width, height),
    setRunning: (next) => {
      running = next;
      apply();
    },
    dispose: () => {
      study.dispose?.();
      stage.dispose();
    },
  };
}
