/**
 * The one contract every lab experiment meets (Lab principles P4).
 *
 * An experiment is a study: metadata the page can show before anything
 * loads (what technique it teaches, which principles it applies, which
 * parameters it exposes), and a scene module, imported only when the study is
 * opened, that mounts into a host element and hands back a handle.
 */
import type { ComponentType } from "react";
import type { LabGraph } from "@/components/lab/lab-graph";
import type { SceneBackend } from "@/scene/backend";
import type { ScenePalette } from "@/scene/palette";
import type { Timing } from "@/lib/timing";

/** A Lab principle, by its id in DESIGN-UI.md → Lab principles. */
type LabRuleId =
  | "M1"
  | "M2"
  | "M3"
  | "M4"
  | "M5"
  | "M6"
  | "M7"
  | "L1"
  | "L2"
  | "L3"
  | "L4"
  | "L5"
  | "P1"
  | "P2"
  | "P3"
  | "P4"
  | "P5"
  | "T1";

export type LabControlValue = number | boolean | string;
export type LabControlValues = Readonly<Record<string, LabControlValue>>;

/** A live parameter the info card offers. `value` is the starting value. */
export type LabControl =
  | {
      readonly kind: "range";
      readonly id: string;
      readonly label: string;
      readonly min: number;
      readonly max: number;
      readonly step: number;
      readonly value: number;
      readonly unit?: string;
    }
  | {
      readonly kind: "toggle";
      readonly id: string;
      readonly label: string;
      readonly value: boolean;
    }
  | {
      readonly kind: "choice";
      readonly id: string;
      readonly label: string;
      readonly options: readonly { readonly value: string; readonly label: string }[];
      readonly value: string;
    };

/** A node under the pointer, in host-relative CSS pixels (a study that reads the graph). */
export interface LabHover {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
}

export interface LabSceneInit {
  readonly palette: ScenePalette;
  readonly dark: boolean;
  readonly reducedMotion: boolean;
  readonly timing: Timing;
  readonly values: LabControlValues;
  /** Only a study that reads the graph uses these three. */
  readonly graph: LabGraph;
  readonly onHover: (hover: LabHover | null) => void;
  readonly onOpen: (id: string) => void;
}

/** A mounted scene. `dispose` releases every GPU resource, loop and listener it took. */
export interface LabScene {
  readonly backend: SceneBackend;
  /** Present only on a study that reads the graph. */
  readonly setGraph?: (graph: LabGraph) => void;
  setPalette(palette: ScenePalette, dark: boolean): void;
  setReducedMotion(reduced: boolean): void;
  setControl(id: string, value: LabControlValue): void;
  /** CSS pixels; the stage clamps the device pixel ratio itself. */
  resize(width: number, height: number): void;
  /** Off while the tab is hidden: no frames are drawn. */
  setRunning(running: boolean): void;
  dispose(): void;
}

type MountLabScene = (host: HTMLElement, init: LabSceneInit) => Promise<LabScene>;

/** What a study says about itself, shown in its info card. */
export interface LabStudy {
  readonly label: string;
  /** The technique, named. */
  readonly technique: string;
  /** What watching and poking it teaches. */
  readonly teaches: string;
  /** The principles it applies, and how, in this study's own terms. */
  readonly rules: readonly { readonly id: LabRuleId; readonly how: string }[];
  readonly controls: readonly LabControl[];
  /** Extra teaching UI beside the card (the motion study's curve panel). */
  readonly Panel?: ComponentType<{ readonly values: LabControlValues; readonly timing: Timing }>;
  readonly load: () => Promise<MountLabScene>;
}

export function initialValues(controls: readonly LabControl[]): LabControlValues {
  return Object.fromEntries(controls.map((control) => [control.id, control.value]));
}

/** A control's value as a number (a range), with the study's own default. */
export function numberOf(values: LabControlValues, id: string, fallback: number): number {
  const value = values[id];
  return typeof value === "number" ? value : fallback;
}
