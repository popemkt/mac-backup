import { useState } from "react";
import { cardinalityOf } from "@kb/model";
import { PlusIcon, XIcon } from "@phosphor-icons/react";
import { mutations } from "@/actions/mutations";
import { cn } from "@/lib/cn";
import { isValueMismatch, resolveFieldTypeById, type FieldType } from "@/lib/field-type";
import { formatPropValue, resolveProps } from "@/lib/graph-view";
import { isSysPrefixed, type PropValue } from "@/lib/types";
import { useDebugFields } from "@/stores/debug-fields.store";
import { fieldContextOf, type FieldContext } from "@/lib/schema";
import { useOutlineStore } from "@/stores/outline.store";
import { useFollow } from "@/stores/follow";
import type { Follow } from "@/lib/follow";
import { FieldRow } from "./field-row";
import { ValueSlot } from "./value-slot";
import { FieldPicker, type FieldHandle } from "./field-value";
import { valueKindOf, VALUE_KINDS } from "@/lib/value-kind";

interface FieldsSectionProps {
  nodeId: string;
  depth: number;
}

export interface FieldValueStackProps {
  nodeId: string;
  fieldId: string;
  fieldType: FieldType;
  values: PropValue[];
  /** What the values resolve against (`fieldContextOf`). */
  context: FieldContext;
  readOnly: boolean;
  /** Carry out a follow from inside a value (`useFollow`). */
  onFollow: Follow;
}

/**
 * The values of one field, stacked under one label.
 *
 * Props are multi-valued, and this used to render a whole FieldRow per value —
 * so a field with three values repeated its own name three times. Tana shows the
 * label once and a column of values beneath it, which is also the honest shape:
 * the label belongs to the field, not to each value.
 *
 * The stack is also the field as a whole to its slots (`FieldHandle`): it adds
 * and removes values, mints picker targets, and — for a many-valued field of
 * picked values — draws the one picker that edits them all, after the values,
 * so toggling a value off never closes the picker it was toggled in.
 */
export function FieldValueStack({
  nodeId,
  fieldId,
  fieldType,
  values,
  context,
  readOnly,
  onFollow,
}: FieldValueStackProps) {
  const { schema } = context;
  const spec = VALUE_KINDS[valueKindOf(fieldType, fieldId, schema.get(fieldId))];
  const many = cardinalityOf(schema.get(fieldId)?.props) === "many";
  /** Slots the user minted with "+ value" and has not filled yet. */
  const [pendingSlots, setPendingSlots] = useState(0);
  /** The field's picker is open (a many-valued field of picked values). */
  const [picking, setPicking] = useState(false);
  const field: FieldHandle = {
    values,
    many,
    add: (value) => void mutations.updateProp(nodeId, fieldId, value),
    remove: (value) => void mutations.removeProp(nodeId, fieldId, value),
    create: (creation, name) => mutations.createRefTarget(creation, name),
    openPicker: () => setPicking(true),
  };
  /**
   * The empty slots to render, each carrying *why it exists* — the one piece of
   * knowledge only this component has, and the thing the editors need in order
   * to decide whether they own the focus. A slot that exists only because the
   * field is unset was nobody's gesture, so it opens closed; a slot minted by
   * "+ value" is the continuation of that click and opens focused.
   */
  const emptySlots: boolean[] = picking
    ? []
    : values.length === 0
      ? [false]
      : Array.from({ length: pendingSlots }, () => true);

  return (
    <div
      className={cn(
        "flex min-w-0",
        // Chips wrap on one line; every other kind stacks a value per line.
        spec.layout === "inline" ? "flex-row flex-wrap items-start gap-x-1" : "flex-col",
      )}
      data-field-values={fieldId}
      data-layout={spec.layout}
    >
      {values.map((value, i) => (
        <ValueItem
          // oxlint-disable-next-line react/no-array-index-key -- GAP [[01M1MFP33RDP5MVB4827DR5RE7]]
          key={`${i}-${JSON.stringify(value)}`}
          layout={spec.layout}
          onRemove={readOnly ? null : () => field.remove(value)}
        >
          <ValueSlot
            value={value}
            display={formatPropValue(value, schema)}
            fieldType={fieldType}
            fieldId={fieldId}
            context={context}
            field={field}
            onFollow={onFollow}
            onCommit={(next: PropValue) => void mutations.updateProp(nodeId, fieldId, next, value)}
          />
        </ValueItem>
      ))}

      {emptySlots.map((autoOpen, i) => (
        <ValueSlot
          // oxlint-disable-next-line react/no-array-index-key -- GAP [[01M1MFP33RDP5MVB4827DR5RE7]]
          key={`empty-${i}`}
          value={null}
          fieldType={fieldType}
          fieldId={fieldId}
          autoOpen={autoOpen}
          context={context}
          field={field}
          onFollow={onFollow}
          onCommit={(next: PropValue) => {
            setPendingSlots(0);
            field.add(next);
          }}
        />
      ))}

      {picking && (
        <FieldPicker
          fieldId={fieldId}
          context={context}
          field={field}
          onReplace={(id) => field.add({ t: "ref", v: id })}
          onClose={() => setPicking(false)}
        />
      )}

      {!readOnly && values.length > 0 && many && !picking && (
        <button
          type="button"
          className={cn(
            "mt-px flex w-fit items-center gap-1 rounded-sm px-1 py-px",
            "text-label text-foreground/30 opacity-0 transition-opacity",
            "group-hover/field:opacity-100 focus-visible:opacity-100",
            "hover:bg-foreground/[0.06] hover:text-foreground/60",
            "focus-visible:ring-2 focus-visible:ring-primary/60 outline-none",
          )}
          onClick={() =>
            spec.editor === "picker" ? setPicking(true) : setPendingSlots((n) => n + 1)
          }
        >
          <PlusIcon size={9} weight="bold" aria-hidden />
          value
        </button>
      )}
    </div>
  );
}

/** One value in a stack, with the hover "×" that removes it. */
function ValueItem({
  layout,
  onRemove,
  children,
}: {
  layout: "stack" | "inline";
  /** Null: the field is read-only here, and offers no remove. */
  onRemove: (() => void) | null;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "group/value flex min-w-0 items-start gap-1",
        layout === "inline" && "max-w-full",
      )}
      data-field-value="true"
    >
      <div className={cn("min-w-0", layout === "stack" && "flex-1")}>{children}</div>
      {onRemove !== null && (
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
            onRemove();
          }}
        >
          <XIcon size={9} weight="bold" aria-hidden />
        </button>
      )}
    </div>
  );
}

interface NodeFieldProps {
  nodeId: string;
  fieldId: string;
  /** The field's name, as the surface resolved it. */
  label: string;
  values: PropValue[];
  /** What the values resolve against (`fieldContextOf`). */
  context: FieldContext;
  /** Indent of the label column; a card passes -1, a row its own depth. */
  depth?: number;
  /** A table cell: the column header is the label, so the row draws none. */
  valueOnly?: boolean;
  /** A `sys.*` prop shown because the node asked for its debug fields. */
  debug?: boolean;
}

/**
 * One field of one node, on any surface: its row chrome and its values.
 *
 * Outline rows, table cells and board cards are three projections of the same
 * field, so they draw it with this one component and differ only in the
 * chrome they ask `FieldRow` for. Each of them used to carry its own loop of
 * "one editor per value, or one empty editor", which is how the table and the
 * cards ended up without remove and add while the outline had both.
 */
export function NodeField({
  nodeId,
  fieldId,
  label,
  values,
  context,
  depth = 0,
  valueOnly = false,
  debug = false,
}: NodeFieldProps) {
  const follow = useFollow();
  const fieldType = resolveFieldTypeById(fieldId, context.schema);
  return (
    <FieldRow
      depth={depth}
      valueOnly={valueOnly}
      fieldType={fieldType}
      fieldId={fieldId}
      label={label}
      debug={debug}
      mismatch={values.some((v) => isValueMismatch(fieldType, v))}
    >
      <FieldValueStack
        nodeId={nodeId}
        fieldId={fieldId}
        fieldType={fieldType}
        values={values}
        context={context}
        readOnly={isSysPrefixed(nodeId) || debug}
        onFollow={follow}
      />
    </FieldRow>
  );
}

/** Inline field rows under a node (DESIGN-RESKIN §1.4). */
export function FieldsSection({ nodeId, depth }: FieldsSectionProps) {
  const node = useOutlineStore((s) => s.nodes.get(nodeId));
  // Field definitions come from the whole graph, never the scoped projection.
  const context = useOutlineStore(fieldContextOf);
  // Debug rows are this node's own business (⌘K → "Show debug fields").
  const showDebugFields = useDebugFields(nodeId);

  if (!node) return null;
  const props = resolveProps(node, context.schema, { showDebugFields });
  if (props.length === 0) return null;

  return (
    <div className="fields-section" data-fields-for={nodeId}>
      {props.map((p) => (
        <NodeField
          key={p.fieldId}
          nodeId={nodeId}
          fieldId={p.fieldId}
          label={p.fieldName}
          values={p.values}
          context={context}
          depth={depth}
          debug={"debug" in p ? Boolean(p.debug) : false}
        />
      ))}
    </div>
  );
}
