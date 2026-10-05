/**
 * The canvas family's system ids (DESIGN.md → Extension families → ids are
 * frozen data). They kept their spelling when they left core's table, so a
 * store seeded before the move opens without a write.
 */
export const CANVAS_IDS = {
  /** The `#canvas` tag: a node tagged with it is a canvas. */
  canvasTag: "sys.tag.canvas",
  /**
   * A canvas node's JSON Canvas 1.0 document (text, single). DESIGN.md →
   * Canvas documents.
   */
  canvasField: "sys.f.canvas",
} as const;
