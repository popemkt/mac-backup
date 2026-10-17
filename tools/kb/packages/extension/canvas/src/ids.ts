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
  /**
   * The projection a canvas view node opens its canvas in (ref, single): one
   * of the field's two option children. DESIGN.md → Canvas documents → Camera.
   */
  canvasProjectionField: "sys.f.canvas.projection",
  canvasProjection2d: "sys.canvas-projection.2d",
  canvasProjection3d: "sys.canvas-projection.3d",
  /** The 3D pose a canvas view node last looked at its canvas from, as JSON (text, single). */
  canvasPoseField: "sys.f.canvas.pose",
  /** The `#comment` tag: a node tagged with it is a comment on a canvas, or a reply to one. */
  commentTag: "sys.tag.comment",
  /** The canvas a comment is on (ref, single): what makes it the canvas's backlink. */
  commentCanvasField: "sys.f.comment.canvas",
  /** The node a comment is about, pinned on each card that shows it there (ref, single). */
  commentNodeField: "sys.f.comment.node",
  /** The item a comment is pinned to, by its id, when it is no card (text, single). */
  commentItemField: "sys.f.comment.item",
  /** The point a comment is pinned at, `x,y` in canvas units, when it is on no item (text, single). */
  commentAtField: "sys.f.comment.at",
  /** Whether a thread is open or resolved (ref, single): one of the field's two option children. */
  commentStateField: "sys.f.comment.state",
  commentOpen: "sys.comment-state.open",
  commentResolved: "sys.comment-state.resolved",
} as const;
