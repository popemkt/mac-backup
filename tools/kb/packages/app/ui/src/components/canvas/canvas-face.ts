import type { CSSProperties } from "react";

/**
 * What an item's face is handed by the projection that shows it: where it is
 * laid out — the 2D canvas lays it on its footprint box (`cardBoxStyle`) —
 * and whether it is being edited. Which item is edited is the page's, one
 * state for both projections, so either may open a face's editor and the
 * face says when its editor closes.
 */
export interface FaceLayout {
  /** The face's box as CSS on its absolutely placed element. */
  readonly box: CSSProperties;
  /** Its editor is open. */
  readonly editing: boolean;
  /** Its editor opened (true) or closed (false). */
  readonly onEdit: (editing: boolean) => void;
}
