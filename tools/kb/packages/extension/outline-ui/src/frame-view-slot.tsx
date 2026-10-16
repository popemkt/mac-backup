import { useMemo } from "react";
import {
  frameViewLabelOf,
  FrameSubjectContext,
  type OutlineNode,
  schemaOf,
  useFrameView,
  useFrameViewNode,
  useGraphRead,
  usePageGraph,
  ViewNotLoaded,
  ViewSlot,
  ViewUnavailable,
} from "@kb/ui-sdk";
import { outlineFrameSubject } from "./outline-frame";
import { useOutlineStore } from "./outline.store";

/**
 * A frame whose view node names a view not provided here: the kit's "cannot be
 * shown here" state, inline, naming the view by its option node.
 */
function UnheldFrameView({ viewNode }: { readonly viewNode: OutlineNode | undefined }) {
  const label = frameViewLabelOf(viewNode, usePageGraph(schemaOf));
  return label === null ? (
    <ViewUnavailable why="Its view node names no view this graph holds." placement="inline" />
  ) : (
    <ViewNotLoaded label={label} placement="inline" />
  );
}

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
  const viewNode = useFrameViewNode(frame);
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
        <UnheldFrameView viewNode={viewNode} />
      ) : (
        <ViewSlot
          view={view.key}
          params={view.params}
          placement="inline"
          fallback={<ViewNotLoaded label={view.key.label} placement="inline" />}
          subject={frameId}
        />
      )}
    </FrameSubjectContext.Provider>
  );
}
