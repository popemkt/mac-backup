import type { CSSProperties } from "react";
import type { CanvasProjectionKind } from "@kb/canvas";

/**
 * What an item's face is handed by the projection that shows it: which
 * projection that is, where it is laid out — the 2D canvas lays it on its
 * footprint box (`cardBoxStyle`) — and whether it is being edited. Which item
 * is edited is the page's, one state for both projections, so either may
 * open a face's editor and the face says when its editor closes.
 */
export interface FaceLayout {
  /**
   * The projection drawing it. A node a card shows is one instance per
   * projection (`canvasInstanceKey`), so only the one showing edits it.
   */
  readonly projection: CanvasProjectionKind;
  /** The face's box as CSS on its absolutely placed element. */
  readonly box: CSSProperties;
  /** Its editor is open. */
  readonly editing: boolean;
  /** Its editor opened (true) or closed (false). */
  readonly onEdit: (editing: boolean) => void;
}
