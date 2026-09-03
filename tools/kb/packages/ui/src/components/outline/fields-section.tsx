import { useState } from "react";
import { Plus, X } from "@phosphor-icons/react";
import { mutations } from "@/actions/mutations";
import { cn } from "@/lib/cn";
import {
  isValueMismatch,
  resolveAllowedRefIdsCached,
  resolveFieldTypeById,
  type FieldType,
} from "@/lib/field-type";
import { formatPropValue, resolveProps } from "@/lib/graph-view";
import { isSysPrefixed, SYSTEM_IDS, type NodeMap, type PropValue } from "@/lib/types";
import { useDebugFields } from "@/stores/debug-fields.store";
import { useOutlineStore } from "@/stores/outline.store";
import { FieldRow } from "./field-row";
import { EmptyTypedEditor, PropValueEditor } from "./field-value";

interface FieldsSectionProps {
  nodeId: string;
  depth: number;
}

export interface FieldValueStackProps {
  nodeId: string;
  fieldId: string;
  fieldType: FieldType;
  allowedRefIds: Set<string> | null;
  values: PropValue[];
  nodes: NodeMap;
  readOnly: boolean;
}

/**
 * The values of one field, stacked under one label.
 *
 * Props are multi-valued, and this used to render a whole FieldRow per value —
 * so a field with three values repeated its own name three times. Tana shows the
 * label once and a column of values beneath it, which is also the honest shape:
 * the label belongs to the field, not to each value.
 */
export function FieldValueStack({
  nodeId,
  fieldId,
  fieldType,
  allowedRefIds,
  values,
  nodes,
  readOnly,
}: FieldValueStackProps) {
  /** Slots the user minted with "+ value" and has not filled yet. */
  const [pendingSlots, setPendingSlots] = useState(0);
  /**
   * The empty slots to render, each carrying *why it exists* — the one piece of
   * knowledge only this component has, and the thing the editors need in order
   * to decide whether they own the focus. A slot that exists only because the
   * field is unset was nobody's gesture, so it opens closed; a slot minted by
   * "+ value" is the continuation of that click and opens focused.
   */
  const emptySlots: boolean[] =
    values.length === 0 ? [false] : Array.from({ length: pendingSlots }, () => true);

  return (
    <div className="flex min-w-0 flex-col" data-field-values={fieldId}>
      {values.map((value, i) => (
        <div
          key={`${i}-${JSON.stringify(value)}`}
          className="group/value flex min-w-0 items-start gap-1"
          data-field-value="true"
        >
          <div className="min-w-0 flex-1">
            <PropValueEditor
              value={value}
              display={formatPropValue(value, nodes)}
              fieldType={fieldType}
              fieldId={fieldId}
              allowedRefIds={allowedRefIds}
              nodes={nodes}
              onCommit={(next: PropValue) =>
                void mutations.updateProp(nodeId, fieldId, next, value)
              }
            />
          </div>
          {!readOnly && (
            <button
              type="button"
              className={cn(
                "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm",
                "text-foreground/20 opacity-0 transition-opacity",
                "group-hover/value:opacity-100 focus-visible:opacity-100",
                "hover:bg-foreground/8 hover:text-foreground/50",
                "focus-visible:ring-2 focus-visible:ring-primary/60 outline-none",
              )}
              title="Remove this value"
              aria-label="Remove this value"
              onClick={(e) => {
                e.stopPropagation();
                void mutations.removeProp(nodeId, fieldId, value);
              }}
            >
              <X size={9} weight="bold" aria-hidden />
            </button>
          )}
        </div>
      ))}

      {emptySlots.map((autoOpen, i) => (
        <EmptyTypedEditor
          key={`empty-${i}`}
          fieldType={fieldType}
          fieldId={fieldId}
          allowedRefIds={allowedRefIds}
          autoOpen={autoOpen}
          nodes={nodes}
          onCommit={(next: PropValue) => {
            setPendingSlots(0);
            void mutations.updateProp(nodeId, fieldId, next);
          }}
        />
      ))}

      {!readOnly && values.length > 0 && (
        <button
          type="button"
          className={cn(
            "mt-px flex w-fit items-center gap-1 rounded-sm px-1 py-px",
            "text-[11px] text-foreground/30 opacity-0 transition-opacity",
            "group-hover/field:opacity-100 focus-visible:opacity-100",
            "hover:bg-foreground/[0.06] hover:text-foreground/60",
            "focus-visible:ring-2 focus-visible:ring-primary/60 outline-none",
          )}
          onClick={() => setPendingSlots((n) => n + 1)}
        >
          <Plus size={9} weight="bold" aria-hidden />
          value
        </button>
      )}
    </div>
  );
}

/** Inline field rows under a node (DESIGN-RESKIN §1.4). */
export function FieldsSection({ nodeId, depth }: FieldsSectionProps) {
  const node = useOutlineStore((s) => s.nodes.get(nodeId));
  const nodes = useOutlineStore((s) => s.nodes);
  const queryDb = useOutlineStore((s) => s.queryDb);
  const rev = useOutlineStore((s) => s.rev);
  // Debug rows are this node's own business (⌘K → "Show debug fields").
  const showDebugFields = useDebugFields(nodeId);

  if (!node) return null;
  const props = resolveProps(node, nodes, { showDebugFields });
  if (props.length === 0) return null;
  const nodeReadOnly = isSysPrefixed(nodeId);

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
            ? resolveAllowedRefIdsCached(p.fieldId, fieldNode, nodes, queryDb, rev)
            : null;
        const debug = "debug" in p ? Boolean(p.debug) : false;
        const values = p.values;

        return (
          <FieldRow
            key={p.fieldId}
            depth={depth}
            fieldType={fieldType}
            fieldId={p.fieldId}
            label={p.fieldName}
            debug={debug}
            mismatch={values.some((v) => isValueMismatch(fieldType, v))}
          >
            <FieldValueStack
              nodeId={nodeId}
              fieldId={p.fieldId}
              fieldType={fieldType}
              allowedRefIds={allowedRefIds}
              values={values}
              nodes={nodes}
              readOnly={nodeReadOnly || debug}
            />
          </FieldRow>
        );
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
