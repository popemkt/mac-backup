import { Hash } from "@phosphor-icons/react";
import { useMemo } from "react";
import { queryBacklinks } from "@/ds/db";
import { cn } from "@/lib/cn";
import { MdView } from "@/components/outline/md-view";
import type { TagBadge } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";

export interface BacklinkRow {
  id: string;
  text: string;
  tags: TagBadge[];
}

/**
 * Inline "References (N)" at the bottom of a zoomed view (DESIGN-RESKIN
 * §1.5) — shallow backlink rows (text + chips only), click = zoom.
 */
export function ReferencesSection({ nodeId }: { nodeId: string }) {
  const queryDb = useOutlineStore((s) => s.queryDb);
  const nodes = useOutlineStore((s) => s.nodes);
  const rev = useOutlineStore((s) => s.rev);

  const backlinks = useMemo((): BacklinkRow[] => {
    if (!queryDb) return [];
    return queryBacklinks(queryDb, nodeId)
      .filter((b) => b.id !== nodeId)
      .map((b) => ({
        id: b.id,
        text: b.text,
        tags: nodes.get(b.id)?.tags ?? [],
      }));
    // rev: backlinks must re-run on every graph change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryDb, nodeId, rev, nodes]);

  return <ReferencesView nodeId={nodeId} backlinks={backlinks} />;
}

/** Pure render half — testable without the live store. */
export function ReferencesView({
  nodeId,
  backlinks,
}: {
  nodeId: string;
  backlinks: BacklinkRow[];
}) {
  if (backlinks.length === 0) return null;

  return (
    <section className="references-section" data-references-for={nodeId}>
      <h2 className="mt-3 mb-1 text-[12px] uppercase tracking-wide text-foreground/30">
        References ({backlinks.length})
      </h2>
      {backlinks.map((row) => (
        <ShallowBacklinkRow key={row.id} row={row} />
      ))}
    </section>
  );
}

function ShallowBacklinkRow({ row }: { row: BacklinkRow }) {
  const zoomTo = useOutlineStore((s) => s.zoomTo);

  return (
    <button
      type="button"
      className="node-row flex w-full min-h-[var(--kb-row-h)] items-start rounded-sm text-left"
      data-node-id={row.id}
      onClick={() => zoomTo(row.id)}
    >
      <span
        className="flex shrink-0 items-center justify-center"
        style={{ width: "var(--kb-row-h)", height: "var(--kb-row-h)" }}
        aria-hidden
      >
        <span className="inline-block h-[18px] w-[18px] rounded-full border border-dashed border-foreground/45" />
      </span>
      <MdView text={row.text} className="min-w-0 flex-1 text-foreground/85" />
      {row.tags.length > 0 && (
        <div
          className="flex shrink-0 items-center gap-0.5"
          style={{ height: "var(--kb-row-h)" }}
        >
          {row.tags.map((tag) => (
            <span
              key={tag.id}
              className={cn(
                "kb-chip inline-flex items-center gap-0.5 rounded-sm px-1.5 py-px",
                "font-medium select-none whitespace-nowrap",
                "bg-primary/10 text-primary",
              )}
              title={`Go to: ${tag.name}`}
            >
              <Hash size={10} weight="bold" className="shrink-0 opacity-60" />
              {tag.name}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}
