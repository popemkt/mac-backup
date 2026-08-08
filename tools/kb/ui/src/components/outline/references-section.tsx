import { useMemo } from "react";
import { queryBacklinks } from "@/ds/db";
import { useOutlineStore } from "@/stores/outline.store";
import { NodeBlock } from "./node-block";

/**
 * Inline "References (N)" at the bottom of a zoomed view (DESIGN-RESKIN
 * §1.5) — replaces the old NODE panel backlinks. Rows are the same
 * read-only ref rows query results use: dashed bullet, click = zoom.
 */
export function ReferencesSection({ nodeId }: { nodeId: string }) {
  const queryDb = useOutlineStore((s) => s.queryDb);
  const rev = useOutlineStore((s) => s.rev);

  const backlinks = useMemo(() => {
    if (!queryDb) return [];
    return queryBacklinks(queryDb, nodeId).filter((b) => b.id !== nodeId);
    // rev: backlinks must re-run on every graph change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryDb, nodeId, rev]);

  return <ReferencesView nodeId={nodeId} backlinkIds={backlinks.map((b) => b.id)} />;
}

/** Pure render half — testable without the live store. */
export function ReferencesView({
  nodeId,
  backlinkIds,
}: {
  nodeId: string;
  backlinkIds: string[];
}) {
  if (backlinkIds.length === 0) return null;

  return (
    <section className="references-section" data-references-for={nodeId}>
      <h2 className="mt-3 mb-1 text-[12px] uppercase tracking-wide text-foreground/30">
        References ({backlinkIds.length})
      </h2>
      {backlinkIds.map((id) => (
        <NodeBlock key={id} nodeId={id} depth={0} isRef />
      ))}
    </section>
  );
}
