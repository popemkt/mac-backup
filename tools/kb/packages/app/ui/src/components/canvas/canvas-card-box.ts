import type { CSSProperties } from "react";
import type { CanvasNode } from "@kb/canvas";

/**
 * Where the 2D canvas lays an item's face out, as CSS on its absolutely
 * placed element: the item's footprint box, which the top view draws it in.
 * Every kind of card is placed by this one rule.
 */
export function cardBoxStyle(card: CanvasNode): CSSProperties {
  return { left: card.x, top: card.y, width: card.width, height: card.height };
}
