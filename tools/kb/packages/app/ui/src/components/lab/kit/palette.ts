/**
 * The lab palette: the `--lab-*` tokens in `design-system.css` in the scene
 * palette's five roles. The accent is the app's own `--primary`.
 */
import { readScenePalette, type ScenePalette } from "@/scene/palette";

export function readLabPalette(): ScenePalette {
  return readScenePalette({
    ground: "--lab-ground",
    edge: "--lab-edge",
    hue: "--lab-hue",
    ink: "--lab-ink",
    accent: "--lab-accent",
  });
}
