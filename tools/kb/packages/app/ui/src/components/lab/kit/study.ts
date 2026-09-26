/**
 * `mountStudy`: the one way a study becomes a `LabScene` (Lab principles P4).
 *
 * A study supplies only what is its own — how it builds its scene, what a
 * frame does, what a control changes. The stage, the reveal (P2), the
 * reduced-motion rule (M7) and giving the stage back when a build fails are
 * the scene kit's (`mountScene`); what is left here is the study's side: its
 * frame always moves (a study is never idle while it may animate), and the
 * theme hand-off.
 */
import type { LabControlValue, LabScene, LabSceneInit } from "@/components/lab/kit/contract";
import type { LabGraph } from "@/components/lab/lab-graph";
import type { ScenePalette } from "@/scene/palette";
import { mountScene, type SceneStage, type StageOptions } from "@/scene/gpu/stage";

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
  readonly setPalette?: (palette: ScenePalette, dark: boolean) => void;
  readonly setGraph?: (graph: LabGraph) => void;
  /** Release what the stage's scene traversal does not reach (listeners, textures). */
  readonly dispose?: () => void;
}

type StudyOptions = Omit<StageOptions, "palette" | "timing" | "reducedMotion">;

export async function mountStudy(
  host: HTMLElement,
  init: LabSceneInit,
  options: StudyOptions,
  build: (stage: SceneStage, init: LabSceneInit, context: StudyContext) => StudyParts,
): Promise<LabScene> {
  const { stage, parts, handle } = await mountScene(
    host,
    { ...options, palette: init.palette, timing: init.timing, reducedMotion: init.reducedMotion },
    (on) => {
      const study = build(on, init, { host, reduced: on.reduced });
      study.setPalette?.(init.palette, init.dark);
      return {
        study,
        frame: (dt: number, elapsed: number) => {
          study.frame(dt, elapsed);
          return true;
        },
        ...(study.dispose === undefined ? {} : { dispose: study.dispose }),
      };
    },
  );
  const { study } = parts;
  const setGraph = study.setGraph;
  return {
    ...handle,
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
    setControl: (id, value) => {
      study.setControl(id, value);
      stage.invalidate();
    },
  };
}
