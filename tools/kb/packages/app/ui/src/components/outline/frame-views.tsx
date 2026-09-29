import { useMemo } from "react";
import type { ParamsOf, ViewProps } from "@/lib/plugins";
import { OutlineBoardView, OutlineCardsView, type OutlineTableView } from "@/lib/view-config";
import { BoardCardsView } from "./board-cards-view";
import { useFrameSubject } from "./frame-subject";
import { TableView } from "./table-view";

/** What a frame view shows outside an outline host: there is no frame. */
export function NoFrame() {
  return (
    <p className="px-1 py-0.5 text-meta text-foreground/50" data-no-frame="true">
      No frame to show.
    </p>
  );
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
