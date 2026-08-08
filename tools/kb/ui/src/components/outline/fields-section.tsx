import { mutations } from "@/actions/mutations";
import { formatPropValue, resolveProps } from "@/lib/graph-view";
import type { PropValue } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { FieldRow } from "./field-row";
import { PropValueEditor } from "./field-value";

interface FieldsSectionProps {
  nodeId: string;
  depth: number;
}

/** Inline field rows under a node (DESIGN-RESKIN §1.4). */
export function FieldsSection({ nodeId, depth }: FieldsSectionProps) {
  const node = useOutlineStore((s) => s.nodes.get(nodeId));
  const nodes = useOutlineStore((s) => s.nodes);

  if (!node) return null;
  const props = resolveProps(node, nodes);
  if (props.length === 0) return null;

  return (
    <div className="fields-section" data-fields-for={nodeId}>
      {props.map((p) =>
        p.values.map((v, i) => (
          <FieldRow
            key={`${p.fieldId}-${i}`}
            depth={depth}
            fieldType={v.t}
            label={p.fieldName}
            onRemove={() => void mutations.removeProp(nodeId, p.fieldId, v)}
          >
            <PropValueEditor
              value={v}
              display={formatPropValue(v, nodes)}
              nodes={nodes}
              onCommit={(next) =>
                void mutations.updateProp(nodeId, p.fieldId, next, v)
              }
            />
          </FieldRow>
        )),
      )}
    </div>
  );
}

/** Single pref/settings row — same FieldRow, borderless value slot. */
export function PrefFieldRow({
  icon,
  label,
  children,
}: {
  icon: React.ComponentProps<typeof FieldRow>["icon"];
  label: string;
  children: React.ReactNode;
}) {
  return (
    <FieldRow depth={-1} icon={icon} label={label}>
      {children}
    </FieldRow>
  );
}