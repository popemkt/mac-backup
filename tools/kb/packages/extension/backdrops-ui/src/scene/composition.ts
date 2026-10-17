/**
 * A composition: what a backdrop is, over the scene kit. The stage
 * (`stage.tsx`) owns the canvas, the clock, the pausing, the pointer and the
 * activity signal, and asks a composition for three things only: lay yourself
 * out, advance by `dt`, paint. Sky and Roost differ in layout, actors and
 * behaviour, and in nothing else.
 */
import type { BackdropDirection, BackdropStrength } from "@kb/model";
import type { ScenePalette } from "./palette.ts";
import type { Reactions } from "./reactions.ts";

/** Everything a composition lays itself out against. A change to any field is a new layout. */
export interface SceneConfig {
  /** The frame, CSS pixels. */
  readonly width: number;
  readonly height: number;
  /** Device pixels per CSS pixel the canvas is drawn at. */
  readonly dpr: number;
  readonly direction: BackdropDirection;
  readonly strength: BackdropStrength;
  /** How present the scene is, 0..1: the head's opacity at this strength, folded into the feather. */
  readonly presence: number;
  readonly palette: ScenePalette;
  /** 1 at full detail; the stage lowers it when frames run over budget. */
  readonly quality: number;
}

export interface Composition {
  /** Lay out, or lay out again, for `config`; actors already alive stay alive. */
  readonly configure: (config: SceneConfig) => void;
  /** Advance the world by `dt` seconds (already clamped by the stage). */
  readonly step: (dt: number, reactions: Reactions) => void;
  /** Paint the world as it stands. The canvas is cleared by the stage. */
  readonly draw: (ctx: CanvasRenderingContext2D) => void;
  /** Bring the world to a deliberate resting composition, for reduced motion. */
  readonly settle: (reactions: Reactions) => void;
}

/** A composition is made fresh for each stage, with its own seed. */
export type CompositionFactory = (seed: number) => Composition;
