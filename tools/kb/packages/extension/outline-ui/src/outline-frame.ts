import type { FrameSubject } from "@kb/ui-sdk";
import { FrameRowText } from "./frame-row-text";
import { useOutlineStore } from "./outline.store";

/** Which frame the outline shows, and where: what its host knows of it before a view lays it out. */
type OutlineFrame = Pick<
  FrameSubject,
  "frameId" | "instanceKey" | "rowIds" | "isQuerySource" | "depth"
>;

/**
 * A frame as the outline hands it to the frame view that lays it out, with
 * `pages` of its rows revealed: the outline edits each row's text and fields,
 * and keeps how many pages are revealed, so the rows a view draws are the
 * rows the outline's keyboard walk reaches.
 */
export function outlineFrameSubject(frame: OutlineFrame, pages: number): FrameSubject {
  return {
    ...frame,
    pages,
    revealMorePages: () => useOutlineStore.getState().revealMorePages(frame.frameId),
    RowText: FrameRowText,
  };
}
