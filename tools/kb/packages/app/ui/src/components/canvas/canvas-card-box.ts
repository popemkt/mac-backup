import type { CSSProperties } from "react";
import {
  boxFrame,
  canvasDepth,
  faceShare,
  isUnrotated,
  canvasRotation,
  type CanvasNode,
} from "@kb/canvas";

/**
 * Where the 2D canvas lays an item's face out, as CSS on its absolutely
 * placed element: the item's footprint box, which the top view draws it in.
 * Every kind of card is placed by this one rule.
 *
 * A turned item's face is that box turned about its centre and carried to
 * the plane its face lies on (`faceShare`), as a `matrix3d` built from the
 * one rotation matrix (`@kb/canvas` `rotation.ts`). CSS's axes are the top
 * view's — x right, y down, z toward the eye — and with no perspective on
 * the stage the browser flattens the face straight down, so what it paints
 * and hit-tests is exactly the face's top view.
 */
// A flat item turned face down shows its face mirrored from the top, where
// the 3D scene shows its blank back.
// GAP [[01M41W56GDH3M0TNGX4BDV4STR]]
export function cardBoxStyle(card: CanvasNode): CSSProperties {
  const box = { left: card.x, top: card.y, width: card.width, height: card.height };
  if (isUnrotated(canvasRotation(card))) return box;
  const m = boxFrame(card).matrix;
  // The face's offset from the box's centre, along the box's own up.
  const up = (faceShare(card) - 0.5) * canvasDepth(card);
  const column = [m[0], m[3], m[6], 0, m[1], m[4], m[7], 0, m[2], m[5], m[8], 0];
  const shift = [m[2] * up, m[5] * up, m[8] * up, 1];
  return { ...box, transform: `matrix3d(${[...column, ...shift].join(", ")})` };
}
