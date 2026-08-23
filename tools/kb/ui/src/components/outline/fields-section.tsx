import { mutations } from "@/actions/mutations";
import {
  isValueMismatch,
  resolveAllowedRefIdsCached,
  resolveFieldTypeById,
} from "@/lib/field-type";
import { formatPropValue, resolveProps } from "@/lib/graph-view";
import { SYSTEM_IDS, type PropValue } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { usePrefsStore } from "@/stores/prefs.store";
import { FieldRow } from "./field-row";
import { EmptyTypedEditor, PropValueEditor } from "./field-value";

interface FieldsSectionProps {
  nodeId: string;
  depth: number;
}

/** Inline field rows under a node (DESIGN-RESKIN §1.4). */
export function FieldsSection({ nodeId, depth }: FieldsSectionProps) {
  const node = useOutlineStore((s) => s.nodes.get(nodeId));
  const nodes = useOutlineStore((s) => s.nodes);
  const queryDb = useOutlineStore((s) => s.queryDb);
  const rev = useOutlineStore((s) => s.rev);
  const showAllFields = usePrefsStore((s) => s.showAllFields);

  if (!node) return null;
  const props = resolveProps(node, nodes, { showAllFields });
  if (props.length === 0) return null;

  return (
    <div className="fields-section" data-fields-for={nodeId}>
      {props.map((p) => {
        const fieldType =
          p.fieldId === SYSTEM_IDS.hiddenField
            ? "checkbox"
            : resolveFieldTypeById(p.fieldId, nodes);
        const fieldNode = nodes.get(p.fieldId);
        const allowedRefIds =
          fieldType === "ref"
            ? resolveAllowedRefIdsCached(
                p.fieldId,
                fieldNode,
                nodes,
                queryDb,
                rev,
              )
            : null;
        const slots =
          p.values.length > 0
            ? p.values.map((v) => ({ value: v as PropValue, empty: false }))
            : [{ value: null as PropValue | null, empty: true }];

        return slots.map((slot, i) => (
          <FieldRow
            key={`${p.fieldId}-${i}`}
            depth={depth}
            fieldType={fieldType}
            fieldId={p.fieldId}
            label={p.fieldName}
            debug={"debug" in p ? Boolean(p.debug) : false}
            mismatch={
              slot.value ? isValueMismatch(fieldType, slot.value) : false
            }
            onRemove={
              ("debug" in p && p.debug) || slot.empty || !slot.value
                ? undefined
                : () => void mutations.removeProp(nodeId, p.fieldId, slot.value!)
            }
          >
            {slot.empty || !slot.value ? (
              <EmptyTypedEditor
                fieldType={fieldType}
                fieldId={p.fieldId}
                allowedRefIds={allowedRefIds}
                nodes={nodes}
                onCommit={(next: PropValue) =>
                  void mutations.updateProp(nodeId, p.fieldId, next)
                }
              />
            ) : (
              <PropValueEditor
                value={slot.value}
                display={formatPropValue(slot.value, nodes)}
                fieldType={fieldType}
                fieldId={p.fieldId}
                allowedRefIds={allowedRefIds}
                nodes={nodes}
                onCommit={(next: PropValue) =>
                  void mutations.updateProp(nodeId, p.fieldId, next, slot.value!)
                }
              />
            )}
          </FieldRow>
        ));
      })}
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
