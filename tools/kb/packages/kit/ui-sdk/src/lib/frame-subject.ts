/**
 * What a frame view is shown for: the frame whose rows it lays out, where its
 * host draws it, and what the host draws each row's text with
 * (DESIGN-UI.md → Outline editor → frames). A row's fields are drawn with
 * the page's field editor (`useFieldEditor`), as every surface draws them. A frame view's params are the
 * settings it reads; this is the frame they are applied to, and none of it is
 * config, so it travels beside the params, never in them.
 *
 * The host is the view that shows a frame's rows inline wherever a frame
 * sits (at its root, in a projected frame's row, under a query's results),
 * and builds this subject for each. A frame view lays the rows out; editing
 * a row's text is the host's, so a frame view of any family lays out rows
 * its host edits.
 */
import { createContext, useContext, type ComponentType } from "react";
import type { OutlineNode, TagBadge } from "./types";

/** A row's text, as the host edits it, inside the view's own row chrome. */
export interface FrameRowTextProps {
  readonly node: OutlineNode;
  readonly instanceKey: string;
  readonly isActive: boolean;
  /** The tags the view shows inline with the text; none when it shows them apart. */
  readonly tags: TagBadge[];
}

export interface FrameSubject {
  readonly frameId: string;
  /** The frame's render instance; absent at the host's root. */
  readonly instanceKey?: string | undefined;
  /** Query-result rows, which replace the frame's children. */
  readonly rowIds?: readonly string[] | undefined;
  readonly isQuerySource: boolean;
  /** The indent level of the frame's rows. */
  readonly depth: number;
  /** How many pages of the frame's rows are revealed (`frameRows`' `pages`). */
  readonly pages: number;
  /** Reveal one more page of the frame's rows. */
  readonly revealMorePages: () => void;
  readonly RowText: ComponentType<FrameRowTextProps>;
}

/** Only a frame's host provides it; a frame view outside one has no frame to show. */
export const FrameSubjectContext = createContext<FrameSubject | null>(null);

export function useFrameSubject(): FrameSubject | null {
  return useContext(FrameSubjectContext);
}
