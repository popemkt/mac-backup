import { useMemo } from "react";
import { FrameSubjectContext, useFrameView, useGraphRead, ViewSlot } from "@kb/ui-sdk";
import { outlineFrameSubject } from "./outline-frame";
import { useOutlineStore } from "./outline.store";

const UNAVAILABLE = (
  <p className="px-1 py-0.5 text-meta text-foreground/50" data-frame-view-unavailable="true">
    This view is not available.
  </p>
);

/**
 * A frame's children, shown by the view its config names, through a slot at
 * placement `inline`: the one way an outline host (the outline's root, a
 * projected frame's row, a query's results) renders a frame view. The view
 * lays the rows out; the outline edits each row's text and fields, and keeps
 * how many pages of them are revealed (`outlineFrameSubject`).
 */
export function FrameViewSlot({
  frameId,
  instanceKey,
  rowIds,
  isQuerySource = false,
  depth,
}: {
  readonly frameId: string;
  readonly instanceKey?: string | undefined;
  readonly rowIds?: readonly string[] | undefined;
  readonly isQuerySource?: boolean;
  readonly depth: number;
}) {
  const frame = useGraphRead().outline.get(frameId);
  const view = useFrameView(frame);
  // The pages revealed are the outline's, so the rows a view draws are the
  // rows its keyboard walk reaches.
  const pages = useOutlineStore((s) => s.framePages[frameId] ?? 1);
  const subject = useMemo(
    () => outlineFrameSubject({ frameId, isQuerySource, depth, instanceKey, rowIds }, pages),
    [frameId, instanceKey, rowIds, isQuerySource, depth, pages],
  );
  return (
    <FrameSubjectContext.Provider value={subject}>
      {view === null ? (
        UNAVAILABLE
      ) : (
        <ViewSlot
          view={view.key}
          params={view.params}
          placement="inline"
          fallback={UNAVAILABLE}
          subject={frameId}
        />
      )}
    </FrameSubjectContext.Provider>
  );
}
