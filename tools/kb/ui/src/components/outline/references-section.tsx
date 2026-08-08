import { useMemo } from "react";
import { queryBacklinks } from "@/ds/db";
import { MdView } from "@/components/outline/md-view";
import type { TagBadge } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { Bullet } from "./bullet";
import { NodeRow } from "./node-row";
import { TagChipGroup } from "./tag-chip";

export interface BacklinkRow {
  id: string;
  text: string;
  tags: TagBadge[];
}

/**
 * Inline "References (N)" at the bottom of a zoomed view (DESIGN-RESKIN §1.5).
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryDb, nodeId, rev, nodes]);

  return <ReferencesView nodeId={nodeId} backlinks={backlinks} />;
}

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
      <h2 className="mb-1 mt-3 text-[12px] uppercase tracking-wide text-foreground/30">
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
  const nodes = useOutlineStore((s) => s.nodes);
  const node = nodes.get(row.id);
  const tagColor = row.tags[0]?.color ?? null;

  const bulletNode = node ?? {
    id: row.id,
    text: row.text,
    parentId: null,
    children: [],
    collapsed: true,
    props: {},
    createdAt: "",
    updatedAt: "",
    tags: row.tags,
  };

  return (
    <NodeRow
      depth={0}
      nodeId={row.id}
      className="w-full text-left"
      onRowClick={() => zoomTo(row.id)}
      bullet={
        <Bullet
          node={bulletNode}
          isRef
          tagColor={tagColor}
          onClick={(e) => {
            e.stopPropagation();
            zoomTo(row.id);
          }}
        />
      }
      content={
        <>
          <MdView text={row.text} className="min-w-0 flex-1 text-foreground/85" />
          {row.tags.length > 0 && (
            <TagChipGroup
              tags={row.tags}
              onTagClick={(tag, e) => {
                e.stopPropagation();
                zoomTo(tag.id);
              }}
            />
          )}
        </>
      }
    />
  );
}
