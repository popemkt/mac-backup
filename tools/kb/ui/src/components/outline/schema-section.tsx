import { useMemo } from "react";
import { useOutlineStore } from "@/stores/outline.store";
import {
  queryFieldCarriers,
  queryTaggedInstances,
  schemaZoomKind,
} from "@/lib/schema-zoom";
import { cn } from "@/lib/cn";

/**
 * When zoomed into a tag or field definition, show live schema instances
 * (Tana "Everything tagged #X" / nodes carrying the field).
 */
export function SchemaSection({ nodeId }: { nodeId: string }) {
  const node = useOutlineStore((s) => s.nodes.get(nodeId));
  const queryDb = useOutlineStore((s) => s.queryDb);
  const rev = useOutlineStore((s) => s.rev);
  const jumpToNode = useOutlineStore((s) => s.jumpToNode);
  const zoomTo = useOutlineStore((s) => s.zoomTo);

  const kind = schemaZoomKind(node);

  const hits = useMemo(() => {
    if (!queryDb || !kind) return [];
    return kind === "tag"
      ? queryTaggedInstances(queryDb, nodeId)
      : queryFieldCarriers(queryDb, nodeId);
  }, [queryDb, nodeId, kind, rev]);

  if (!kind) return null;

  const title =
    kind === "tag" ? "Tagged instances" : "Nodes with this field";

  return (
    <section className="mt-6 border-t border-foreground/[0.06] px-1 pt-4">
      <h2 className="mb-2 px-1 text-[12px] uppercase tracking-wide text-foreground/30">
        {title}
        <span className="ml-1.5 font-normal normal-case tracking-normal">
          ({hits.length})
        </span>
      </h2>
      {hits.length === 0 ? (
        <p className="px-1 text-[13px] text-foreground/50">None yet</p>
      ) : (
        <ul className="flex flex-col">
          {hits.map((hit) => (
            <li key={hit.id}>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-1 py-0.5 text-left",
                  "hover:bg-primary/5",
                )}
                style={{ minHeight: "var(--kb-row-h)" }}
                onClick={() => {
                  // Jump into outline home so the instance is editable in context
                  useOutlineStore.getState().zoomHome();
                  jumpToNode(hit.id);
                }}
                onDoubleClick={() => zoomTo(hit.id)}
              >
                <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full border border-dashed border-foreground/45" />
                <span className="kb-text truncate text-foreground/85">
                  {hit.text || "(empty)"}
                </span>
                <span className="ml-auto shrink-0 font-mono text-[10px] text-foreground/30">
                  {hit.id}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
