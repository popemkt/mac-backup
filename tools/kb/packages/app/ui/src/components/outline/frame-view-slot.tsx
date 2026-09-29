import { useMemo } from "react";
import { ViewSlot } from "@/components/ui/view-slot";
import { frameViewOf } from "@/lib/view-config";
import { useOutlineStore } from "@/stores/outline.store";
import { FrameSubjectContext, type FrameSubject } from "./frame-subject";

const UNAVAILABLE = (
  <p className="px-1 py-0.5 text-meta text-foreground/50" data-frame-view-unavailable="true">
    This view is not available.
  </p>
);

/**
 * A frame's children, shown by the view its config names, through a slot at
 * placement `inline`: the one way an outline host (the outline's root, a
 * projected frame's row, a query's results) renders a frame view.
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
  const props = useOutlineStore((s) => s.nodes.get(frameId)?.props);
  const view = useMemo(() => frameViewOf(props), [props]);
  const subject = useMemo(
    (): FrameSubject => ({
      frameId,
      isQuerySource,
      depth,
      instanceKey,
      rowIds,
    }),
    [frameId, instanceKey, rowIds, isQuerySource, depth],
  );
  return (
    <FrameSubjectContext.Provider value={subject}>
      <ViewSlot view={view.key} params={view.params} placement="inline" fallback={UNAVAILABLE} />
    </FrameSubjectContext.Provider>
  );
}
