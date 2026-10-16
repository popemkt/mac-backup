import { useMemo } from "react";
import {
  childInstanceKey,
  frameRows,
  NoFrame,
  outlineInstanceKey,
  useFrameSubject,
  useGraphRead,
  type ViewProps,
} from "@kb/ui-sdk";
import { type ParamsOf, OutlineListView } from "@kb/views";
import { NodeBlock } from "./node-block";
import { useOutlineHost } from "./outline-host";

/**
 * The list view: a frame's children as outline rows — the same rows the
 * visible-instance walk offers keyboard navigation. Each row hosts its own
 * children in turn, through a slot of its own: a list of lists is this view
 * going on down the tree, which the slot does not count as an embed.
 */
export function ListFrameView({ params }: ViewProps<ParamsOf<typeof OutlineListView>>) {
  const subject = useFrameSubject();
  const host = useOutlineHost();
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
    // At the outline's root, a row takes its instance in this outline's host.
    const key =
      instanceKey === undefined
        ? outlineInstanceKey(child.id, nodes, host)
        : childInstanceKey(instanceKey, child.id);
    return <NodeBlock key={key} nodeId={child.id} instanceKey={key} depth={depth} />;
  });
}
