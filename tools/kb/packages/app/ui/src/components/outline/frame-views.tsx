import { useMemo } from "react";
import { frameRows } from "@/lib/frame-rows";
import { childInstanceKey, outlineInstanceKey } from "@/lib/instance-key";
import type { ViewProps } from "@/lib/plugins";
import { useGraphRead } from "@/stores/graph-read";
import {
  type ParamsOf,
  OutlineBoardView,
  OutlineCardsView,
  OutlineListView,
  type OutlineTableView,
} from "@kb/views";
import { BoardCardsView } from "./board-cards-view";
import { useFrameSubject } from "./frame-subject";
import { NodeBlock } from "./node-block";
import { TableView } from "./table-view";

/** What a frame view shows outside an outline host: there is no frame. */
function NoFrame() {
  return (
    <p className="px-1 py-0.5 text-meta text-foreground/50" data-no-frame="true">
      No frame to show.
    </p>
  );
}

/**
 * The list view: a frame's children as outline rows — the same rows the
 * visible-instance walk offers keyboard navigation. Each row hosts its own
 * children in turn, through a slot of its own: a list of lists is this view
 * going on down the tree, which the slot does not count as an embed.
 */
export function ListFrameView({ params }: ViewProps<ParamsOf<typeof OutlineListView>>) {
  const subject = useFrameSubject();
  const { outline: nodes, schema } = useGraphRead();
  const rows = useMemo(
    () =>
      subject === null
        ? []
        : frameRows({
            frameId: subject.frameId,
            nodes,
            schema,
            view: { key: OutlineListView, params },
          }).rendered,
    [subject, nodes, schema, params],
  );
  if (subject === null) return <NoFrame />;
  const { instanceKey, depth } = subject;
  // Every row mounts, on screen or not: load cost is linear in expanded rows
  // (DESIGN-UI.md → Outline editor).
  // GAP [[01M41062Z83M38GYHC276XJ8RF]]
  return rows.map((child) => {
    // At the outline's root, a row takes its canonical instance.
    const key =
      instanceKey === undefined
        ? outlineInstanceKey(child.id, nodes)
        : childInstanceKey(instanceKey, child.id);
    return <NodeBlock key={key} nodeId={child.id} instanceKey={key} depth={depth} />;
  });
}

/** The table view: the frame's rows as one sorted, paged run, a column per field. */
export function TableFrameView({ params }: ViewProps<ParamsOf<typeof OutlineTableView>>) {
  const subject = useFrameSubject();
  if (subject === null) return <NoFrame />;
  return (
    <TableView
      frameId={subject.frameId}
      settings={params}
      frameInstanceKey={subject.instanceKey}
      rowIds={subject.rowIds}
      isQuerySource={subject.isQuerySource}
    />
  );
}

/** The board view: the frame's rows as cards, a column per value of its group field. */
export function BoardFrameView({ params }: ViewProps<ParamsOf<typeof OutlineBoardView>>) {
  const subject = useFrameSubject();
  const view = useMemo(() => ({ key: OutlineBoardView, params }), [params]);
  if (subject === null) return <NoFrame />;
  return (
    <BoardCardsView
      frameId={subject.frameId}
      view={view}
      frameInstanceKey={subject.instanceKey}
      rowIds={subject.rowIds}
      isQuerySource={subject.isQuerySource}
    />
  );
}

/** The cards view: the frame's rows as cards in one grid. */
export function CardsFrameView({ params }: ViewProps<ParamsOf<typeof OutlineCardsView>>) {
  const subject = useFrameSubject();
  const view = useMemo(() => ({ key: OutlineCardsView, params }), [params]);
  if (subject === null) return <NoFrame />;
  return (
    <BoardCardsView
      frameId={subject.frameId}
      view={view}
      frameInstanceKey={subject.instanceKey}
      rowIds={subject.rowIds}
      isQuerySource={subject.isQuerySource}
    />
  );
}
