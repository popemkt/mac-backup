import { useMemo } from "react";
import { useOutlineStore } from "@/stores/outline.store";
import {
  queryFieldCarriers,
  queryTaggedInstances,
  schemaZoomKind,
  type SchemaHit,
} from "@/lib/schema-zoom";
import { MdView } from "@/components/outline/md-view";
import { Bullet } from "./bullet";
import { NodeRow } from "./node-row";
import { TagFieldsConfig } from "./tag-fields-config";
import { TagChipGroup } from "./tag-chip";

/**
 * When zoomed into a tag or field definition, show live schema instances
 * (Tana "Everything tagged #X" / nodes carrying the field).
 */
export function SchemaSection({ nodeId }: { nodeId: string }) {
  const node = useOutlineStore((s) => s.nodes.get(nodeId));
  const queryDb = useOutlineStore((s) => s.queryDb);
  const jumpToNode = useOutlineStore((s) => s.jumpToNode);
  const zoomTo = useOutlineStore((s) => s.zoomTo);

  const kind = schemaZoomKind(node);

  const hits = useMemo(() => {
    if (!queryDb || !kind) return [];
    return kind === "tag"
      ? queryTaggedInstances(queryDb, nodeId)
      : queryFieldCarriers(queryDb, nodeId);
  }, [queryDb, nodeId, kind]);

  if (!kind) return null;

  const title =
    kind === "tag" ? "Tagged instances" : "Nodes with this field";

  return (
    <section className="mt-6 border-t border-foreground/[0.06] px-1 pt-4">
      {kind === "tag" && <TagFieldsConfig tagId={nodeId} />}
      <h2 className="mb-2 px-1 text-[12px] uppercase tracking-wide text-foreground/30">
        {title}
        <span className="ml-1.5 font-normal normal-case tracking-normal">
          ({hits.length})
        </span>
      </h2>
      {hits.length === 0 ? (
        <p className="px-1 text-[13px] text-foreground/50" role="status">
          None yet
        </p>
      ) : (
        hits.map((hit) => (
          <SchemaInstanceRow
            key={hit.id}
            hit={hit}
            onActivate={() => {
              useOutlineStore.getState().zoomHome();
              jumpToNode(hit.id);
            }}
            onZoom={() => zoomTo(hit.id)}
          />
        ))
      )}
    </section>
  );
}

function SchemaInstanceRow({
  hit,
  onActivate,
  onZoom,
}: {
  hit: SchemaHit;
  onActivate: () => void;
  onZoom: () => void;
}) {
  const nodes = useOutlineStore((s) => s.nodes);
  const node = nodes.get(hit.id);
  const tags = node?.tags ?? [];

  const bulletNode = node ?? {
    id: hit.id,
    text: hit.text,
    parentId: null,
    children: [],
    collapsed: true,
    props: {},
    createdAt: "",
    updatedAt: "",
    tags,
  };

  return (
    <div onDoubleClick={onZoom}>
      <NodeRow
        depth={0}
        nodeId={hit.id}
        className="w-full cursor-pointer text-left"
        onRowClick={onActivate}
        bullet={
          <Bullet
            node={bulletNode}
            isRef
            onClick={(e) => {
              e.stopPropagation();
              onZoom();
            }}
          />
        }
        content={
          <>
            <MdView
              text={hit.text || "(empty)"}
              className="min-w-0 flex-1 text-foreground/85"
            />
            {tags.length > 0 && (
              <TagChipGroup
                tags={tags}
                onTagClick={(tag, e) => {
                  e.stopPropagation();
                  onZoom();
                }}
              />
            )}
          </>
        }
      />
    </div>
  );
}
