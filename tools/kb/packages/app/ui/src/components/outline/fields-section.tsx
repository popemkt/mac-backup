import { useLayoutEffect, useRef, useState } from "react";
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
import { rowTextOf } from "@/lib/contextual-ref";
import { arriveAt, slotAt } from "@/lib/value-slot-nav";
import type { Follow } from "@/lib/follow";
import { IconButton } from "@/components/ui/icon-button";
import { FieldRow } from "./field-row";
import { ValueSlot } from "./value-slot";
import { FieldPicker, type FieldHandle } from "./field-picker";
import { valueKindOf, VALUE_KINDS } from "@/lib/value-kind";

interface FieldsSectionProps {
  nodeId: string;
  depth: number;
  /** The row instance these fields are drawn under (the keyboard's way back). */
  instanceKey: string;
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
  /**
   * The row instance the field is drawn under: where the keyboard goes when
   * it leaves the field. Absent, the field keeps it (a story, a test).
   */
  instanceKey?: string;
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
  instanceKey,
}: FieldValueStackProps) {
  const { schema } = context;
  const spec = VALUE_KINDS[valueKindOf(fieldType, fieldId, schema.get(fieldId))];
  const many = cardinalityOf(schema.get(fieldId)?.props) === "many";
  const { field, pending, setPending, picking, pickerQuery, setPicking, stackRef } = useFieldHandle(
    { nodeId, fieldId, values, many, instanceKey },
  );
  const drop = (id: number) => setPending((ids) => ids.filter((x) => x !== id));
  /** Adding is the picker for picked values, and a new empty slot for typed ones. */
  const beginAdd = spec.editor === "picker" ? field.openPicker : field.addSlot;
  const canAdd = !readOnly && many && values.length > 0 && !picking;

  return (
    <div
      ref={stackRef}
      className={cn(
        "flex min-w-0",
        // Chips wrap on one line; every other kind stacks a value per line.
        spec.layout === "inline" ? "flex-row flex-wrap items-start gap-x-1" : "flex-col",
      )}
      data-field-values={fieldId}
      data-layout={spec.layout}
    >
      {valueKeys(values).map(({ key, value }, i) => (
        <ValueItem
          key={key}
          layout={spec.layout}
          onRemove={readOnly ? null : () => field.remove(value)}
          onAdd={canAdd && i === values.length - 1 && pending.length === 0 ? beginAdd : null}
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
            onRemove={() => field.remove(value)}
          />
        </ValueItem>
      ))}

      {values.length === 0 &&
        pending.length === 0 &&
        !picking && (
          // The one slot an unset field shows: nobody's gesture, so it opens closed.
          <ValueSlot
            value={null}
            fieldType={fieldType}
            fieldId={fieldId}
            context={context}
            field={field}
            onFollow={onFollow}
            onCommit={field.add}
          />
        )}

      {pending.map((id) => (
        // A slot a gesture opened for the next value: it opens focused.
        <ValueSlot
          key={`new-${id}`}
          value={null}
          fieldType={fieldType}
          fieldId={fieldId}
          autoOpen
          placeholder="Enter to add another · Esc to finish"
          context={context}
          field={field}
          onFollow={onFollow}
          onCommit={(next: PropValue) => {
            drop(id);
            field.add(next);
          }}
          onRemove={() => drop(id)}
        />
      ))}

      {picking && (
        <FieldPicker
          fieldId={fieldId}
          context={context}
          field={field}
          initialQuery={pickerQuery}
          onReplace={(id) => field.add({ t: "ref", v: id })}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

/**
 * A key per value that survives the others changing: its content, and which
 * occurrence of that content it is (a field may hold one value twice). An
 * index key remounted every value after a removed one — and dropped the
 * keyboard off the neighbour it had just landed on.
 */
function valueKeys(values: readonly PropValue[]): Array<{ key: string; value: PropValue }> {
  const seen = new Map<string, number>();
  return values.map((value) => {
    const content = JSON.stringify(value);
    const n = seen.get(content) ?? 0;
    seen.set(content, n + 1);
    return { key: `${content}#${n}`, value };
  });
}

/**
 * The field as a whole, as its slots see it (`FieldHandle`): writes, the
 * picker and new slots, and the keyboard's way in and out — out of the field
 * to the row it is drawn under, and back onto a value once it redraws.
 */
function useFieldHandle({
  nodeId,
  fieldId,
  values,
  many,
  instanceKey,
}: {
  nodeId: string;
  fieldId: string;
  values: PropValue[];
  many: boolean;
  instanceKey: string | undefined;
}) {
  /**
   * Slots opened for a next value and not written yet, by a stable id each,
   * so the slot a gesture opens is a new one and takes the focus.
   */
  const [pending, setPending] = useState<readonly number[]>([]);
  const nextPending = useRef(0);
  /** The field's picker is open (a many-valued field of picked values), with a query typed. */
  const [picker, setPicker] = useState<{ query: string } | null>(null);
  /** A value the keyboard lands on once the field redraws with new values. */
  const [landing, setLanding] = useState<{ index: number; values: PropValue[] } | null>(null);
  /** The landing already made: it is made until the field has redrawn, then once more. */
  const landed = useRef<typeof landing>(null);
  const stackRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const stack = stackRef.current;
    if (landing === null || stack === null || landed.current === landing) return;
    const slot = slotAt(stack, landing.index) ?? slotAt(stack, landing.index - 1);
    if (slot !== null) arriveAt(slot, "rest");
    if (values !== landing.values) landed.current = landing;
  }, [landing, values]);

  const store = useOutlineStore.getState;
  const field: FieldHandle = {
    values,
    many,
    add: (value) => void mutations.updateProp(nodeId, fieldId, value),
    remove: (value) => void mutations.removeProp(nodeId, fieldId, value),
    create: (creation, name) => mutations.createRefTarget(creation, name),
    openPicker: (query = "") => setPicker({ query }),
    addSlot: () => setPending((ids) => [...ids, (nextPending.current += 1)]),
    leave: (way) => {
      if (instanceKey === undefined) return;
      const s = store();
      if (way === "back") s.selectNode(nodeId, instanceKey);
      else if (way === "up") s.activateNode(nodeId, rowTextOf(s, nodeId).text.length, instanceKey);
      else {
        const next = s.getNextVisibleInstance(instanceKey);
        if (next !== null) s.activateNode(next.nodeId, 0, next.instanceKey);
      }
    },
    claimKeyboard: () => {
      const s = store();
      if (s.selectedNodeId !== null || s.activeNodeId !== null) s.selectNode(null);
    },
    focusSlot: (index) => setLanding({ index, values }),
  };
  return {
    field,
    pending,
    setPending,
    picking: picker !== null,
    pickerQuery: picker?.query,
    setPicking: (open: boolean) => setPicker(open ? { query: "" } : null),
    stackRef,
  };
}

/** One value in a stack, with the hover "×" that removes it. */
function ValueItem({
  layout,
  onRemove,
  onAdd,
  children,
}: {
  layout: "stack" | "inline";
  /** Null: the field is read-only here, and offers no remove. */
  onRemove: (() => void) | null;
  /**
   * The last value of a many-valued field carries the "+" that adds the
   * next. Null everywhere else.
   */
  onAdd: (() => void) | null;
  children: React.ReactNode;
}) {
  const inline = layout === "inline";
  return (
    <div
      className={cn(
        "group/value flex min-w-0 items-start",
        inline ? "relative max-w-full gap-0.5" : "gap-1",
      )}
      data-field-value="true"
    >
      <div className={cn("min-w-0", !inline && "flex-1")}>{children}</div>
      {onRemove !== null &&
        (inline ? (
          <ChipRemoveButton onRemove={onRemove} />
        ) : (
          <ValueAction>
            <IconButton
              label="Remove this value"
              icon={XIcon}
              // The keyboard's remove is Backspace on the value; this is the mouse's.
              tabIndex={-1}
              className="opacity-0 group-hover/value:opacity-100 focus-visible:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
            />
          </ValueAction>
        ))}
      {onAdd !== null && <AddValueButton onAdd={onAdd} />}
    </div>
  );
}

/**
 * The slot a value's trailing action sits in: one text line tall (the `h-6`
 * the label column is aligned to), its button centred on it. Remove and add
 * both sit in it, so they share a line whichever of them a value shows.
 */
function ValueAction({
  zeroWidth = false,
  children,
}: {
  zeroWidth?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className={cn("flex h-6 shrink-0 items-center", zeroWidth && "w-0")}>{children}</span>
  );
}

/**
 * A chip's remove: a badge over its corner, so chips sit as close as tags do.
 * It is part of the chip's anatomy, as a tag chip's "×" over its mark is,
 * rather than a button in the value's trailing space.
 */
function ChipRemoveButton({ onRemove }: { onRemove: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      className={cn(
        "absolute -right-1 -top-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center",
        "rounded-full border border-foreground/10 bg-popover text-foreground/40 hover:text-foreground/70",
        "opacity-0 transition-opacity group-hover/value:opacity-100 focus-visible:opacity-100",
        "focus-visible:ring-2 focus-visible:ring-primary/60 outline-none",
      )}
      title="Remove this value"
      aria-label="Remove this value"
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
    >
      <XIcon size={7} weight="bold" aria-hidden />
    </button>
  );
}

/**
 * The mouse's way to add a value: a "+" in the trailing space of the last
 * value, shown while the field is hovered or holds the focus. Its slot is
 * zero-width, so it costs no line and no width — adding is Enter at the end
 * of a value, or the picker, for the keyboard.
 */
function AddValueButton({ onAdd }: { onAdd: () => void }) {
  return (
    <ValueAction zeroWidth>
      <IconButton
        label="Add a value"
        icon={PlusIcon}
        tabIndex={-1}
        className={cn(
          "opacity-0 group-hover/field:opacity-100 group-focus-within/field:opacity-100",
          "focus-visible:opacity-100",
        )}
        data-add-value="true"
        onClick={(e) => {
          e.stopPropagation();
          onAdd();
        }}
      />
    </ValueAction>
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
  /** The row instance the field is drawn under (the keyboard's way back). */
  instanceKey?: string;
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
  instanceKey,
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
        instanceKey={instanceKey}
      />
    </FieldRow>
  );
}

/** Inline field rows under a node (DESIGN-RESKIN §1.4). */
export function FieldsSection({ nodeId, depth, instanceKey }: FieldsSectionProps) {
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
          instanceKey={instanceKey}
          debug={"debug" in p ? Boolean(p.debug) : false}
        />
      ))}
    </div>
  );
}
