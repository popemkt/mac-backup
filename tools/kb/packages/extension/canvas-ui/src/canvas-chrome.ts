/**
 * Where the 2D stage's chrome lies round what it marks, in canvas units:
 * the ports on every card's sides, a selected card's corner handles and its
 * rotate handle, and an edge's label. The one statement the chrome is drawn
 * by (`CanvasPorts`, `CanvasResizeHandles`, the edge layer's label) and a
 * press's reach is read from (`canvas-visible` `pressRegions`), so what a
 * script draws over the canvas is masked off every handle a press reaches
 * (DESIGN-UI.md → Scripts).
 */

/** A port's button, centred on the middle of each of a card's sides. */
export const PORT_SIZE = 24;

/** A resize handle, centred on each corner of a selected card. */
export const CORNER_HANDLE_SIZE = 16;

/** The rotate handle on its stem, standing above the middle of a selected card's top edge. */
export const ROTATE_HANDLE = { width: 24, height: 36 } as const;

/** An edge label's chip: so wide a character, so much room each side, so tall. */
const LABEL_CHIP = { char: 7, pad: 6, height: 20 } as const;

/** The field that edits an edge's label, over its chip. */
export const LABEL_FIELD = { width: 120, height: 24 } as const;

/** An edge label's chip about the route's middle: its box, from that point. */
export function labelChip(label: string): {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
} {
  const width = label.length * LABEL_CHIP.char + 2 * LABEL_CHIP.pad;
  return { x: -width / 2, y: -LABEL_CHIP.height / 2, width, height: LABEL_CHIP.height };
}

/** How far an item's chrome reaches past its face: its ports, and when selected its handles. */
export function chromeReach(selected: boolean): number {
  return selected
    ? Math.max(ROTATE_HANDLE.height, CORNER_HANDLE_SIZE / 2, PORT_SIZE / 2)
    : PORT_SIZE / 2;
}

/** How far an edge's label (its chip, or the field editing it) reaches about the route's middle. */
export function labelReach(label: string): {
  readonly halfWidth: number;
  readonly halfHeight: number;
} {
  const chip = labelChip(label);
  return {
    halfWidth: Math.max(chip.width, LABEL_FIELD.width) / 2,
    halfHeight: Math.max(chip.height, LABEL_FIELD.height) / 2,
  };
}
