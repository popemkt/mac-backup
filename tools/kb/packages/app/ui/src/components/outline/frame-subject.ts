import { createContext, useContext } from "react";

/**
 * Which frame a frame view shows, and where: what its outline host hands it.
 * A frame view's params are the settings it reads; this is the frame they are
 * applied to, and none of it is config — so it travels beside the params,
 * never in them.
 */
export interface FrameSubject {
  readonly frameId: string;
  /** The frame's render instance; absent at the outline's root. */
  readonly instanceKey?: string | undefined;
  /** Query-result rows, which replace the frame's children. */
  readonly rowIds?: readonly string[] | undefined;
  readonly isQuerySource: boolean;
  /** The indent level of the frame's rows. */
  readonly depth: number;
}

/** Only an outline host provides it; a frame view outside one has no frame to show. */
export const FrameSubjectContext = createContext<FrameSubject | null>(null);

export function useFrameSubject(): FrameSubject | null {
  return useContext(FrameSubjectContext);
}
