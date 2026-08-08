import { formatPropValue, resolveProps } from "@/lib/graph-view";
import { useOutlineStore } from "@/stores/outline.store";

export function NodePanel() {
  const selectedNodeId = useOutlineStore((s) => s.selectedNodeId);
  const nodes = useOutlineStore((s) => s.nodes);
  const node = selectedNodeId ? nodes.get(selectedNodeId) : null;

  if (!node) {
    return (
      <aside className="flex h-full flex-col border-l border-stone-200/80 bg-[var(--panel)]/80 p-4 text-[13px] text-stone-500">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400">
          Node
        </h2>
        <p>Select a node to inspect props and tags.</p>
      </aside>
    );
  }

  const props = resolveProps(node, nodes);

  return (
    <aside className="flex h-full flex-col gap-4 overflow-auto border-l border-stone-200/80 bg-[var(--panel)]/80 p-4 text-[13px]">
      <div>
        <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400">
          Node
        </h2>
        <p className="text-[15px] leading-snug text-stone-900">
          {node.text || "(empty)"}
        </p>
        <p className="mt-1 font-mono text-[10px] text-stone-400">{node.id}</p>
      </div>

      <div>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400">
          Tags
        </h3>
        {node.tags.length === 0 ? (
          <p className="text-stone-400">None</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {node.tags.map((t) => (
              <li
                key={t.id}
                className="rounded-sm bg-teal-900/8 px-2 py-0.5 text-[12px] text-teal-900/70"
              >
                #{t.name}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400">
          Props
        </h3>
        {props.length === 0 ? (
          <p className="text-stone-400">None</p>
        ) : (
          <dl className="space-y-2">
            {props.map((p) => (
              <div key={p.fieldId} className="grid grid-cols-[1fr_1.4fr] gap-2">
                <dt
                  className="truncate text-stone-500"
                  title={p.fieldId}
                >
                  {p.fieldName}
                </dt>
                <dd className="text-stone-800">
                  {p.values.map((v, i) => (
                    <span key={i} className="block truncate">
                      {formatPropValue(v, nodes)}
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </aside>
  );
}
