import { mutations } from "@/actions/mutations";
import { formatPropValue, resolveProps } from "@/lib/graph-view";
import { useOutlineStore } from "@/stores/outline.store";
import { PropValueEditor } from "./field-value";

interface FieldsSectionProps {
  nodeId: string;
  depth: number;
}

/**
 * Inline field rows under a node (nxus anatomy).
 * Indent = (depth+1) × --kb-indent; label width = --kb-field-label.
 * Side panel keeps bulk editing; this is the glanceable inline surface.
 */
export function FieldsSection({ nodeId, depth }: FieldsSectionProps) {
  const node = useOutlineStore((s) => s.nodes.get(nodeId));
  const nodes = useOutlineStore((s) => s.nodes);

  if (!node) return null;
  const props = resolveProps(node, nodes);
  if (props.length === 0) return null;

  return (
    <div
      className="fields-section flex flex-col gap-0.5 pb-0.5"
      style={{
        paddingLeft: `calc(${depth + 1} * var(--kb-indent) + var(--kb-row-h))`,
      }}
      data-fields-for={nodeId}
    >
      {props.map((p) => (
        <div
          key={p.fieldId}
          className="field-row flex min-h-[var(--kb-row-h)] items-start gap-2"
        >
          <div
            className="shrink-0 truncate text-[11px] leading-[var(--kb-row-h)] text-[var(--kb-muted)]"
            style={{ width: "var(--kb-field-label)" }}
            title={p.fieldName}
          >
            {p.fieldName}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {p.values.map((v, i) => (
              <div key={i} className="flex items-center gap-1">
                <PropValueEditor
                  value={v}
                  display={formatPropValue(v, nodes)}
                  compact
                  onCommit={(next) =>
                    void mutations.updateProp(nodeId, p.fieldId, next, v)
                  }
                />
                <button
                  type="button"
                  className="text-[var(--kb-muted)] hover:text-[var(--kb-fg)]"
                  aria-label="Remove value"
                  onClick={() =>
                    void mutations.removeProp(nodeId, p.fieldId, v)
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
