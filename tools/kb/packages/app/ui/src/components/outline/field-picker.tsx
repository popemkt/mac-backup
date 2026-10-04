import { useMemo, useRef, useState } from "react";
import { declaresOptionSet } from "@kb/model";
import {
  cn,
  KB_TEXT_CLASS,
  nodeCandidates,
  orderCandidates,
  PickerList,
  pickerRows,
  refCreationOf,
  refSearchOf,
  refUses,
  textOr,
  usePickerKeys,
  type FieldContext,
  type PickerRow,
  type PropValue,
  type RefCreation,
} from "@kb/ui-sdk";
import { notePick, recentPicks } from "@/lib/picker-recency";

const inputClass = cn(
  "w-full flex-1 rounded-sm border-none bg-transparent px-1 outline-none",
  KB_TEXT_CLASS,
  "text-foreground/70 placeholder:text-foreground/25",
);

/**
 * What a value slot, and a field's picker, may do to the field as a whole —
 * the stack that holds the values provides it.
 */
export interface FieldHandle {
  /** Every value the field holds: a picker shows them checked. */
  readonly values: readonly PropValue[];
  /** The field holds many values: its picker toggles, and stays open. */
  readonly many: boolean;
  add: (value: PropValue) => void;
  remove: (value: PropValue) => void;
  /** Mint a node the field may point at (`refCreationOf`); its id, or null. */
  create: (creation: RefCreation, name: string) => Promise<string | null>;
  /** Open the field's picker, for a many-valued field (the stack draws it), with a query typed. */
  openPicker: (query?: string) => void;
  /** Open an empty slot for the next value, after the last. */
  addSlot: () => void;
  /**
   * The keyboard leaves the field for its row: `up` past the first value
   * (the row's text, at its end), `down` past the last (the next row), or
   * `back` (Escape: the row, selected).
   */
  leave: (way: "up" | "down" | "back") => void;
  /** A value took the keyboard: nothing else in the outline holds it now. */
  claimKeyboard: () => void;
  /**
   * Put the keyboard on the value at `index` once the field has redrawn — the
   * slot that asked may be redrawn itself (a committed value is a new one).
   */
  focusSlot: (index: number) => void;
}

/**
 * The one node picker, as a field's values are chosen with it: an input over
 * the field's allowed targets (`refSearchOf`: its option set, its tag, its
 * query, or the outline), with the list showing from the moment it opens.
 *
 * - **Type to filter**, fuzzily, the matched letters marked (`pickerRows`).
 *   With nothing typed, an option set keeps its own order; other fields
 *   offer the recently picked first, then the most used.
 * - **Already picked is checked.** In a many-valued field Enter (or a click)
 *   toggles a row and the picker stays open for the next; Backspace on an
 *   empty query takes back the last value. In a single-valued field a pick
 *   replaces the value and closes.
 * - **Create** the query as a new node, as the last row, wherever the
 *   field's declaration says a new target goes (`refCreationOf`) — a new
 *   option under the field, a node with the field's tag — and never for a
 *   query-constrained field, whose members kb cannot promise.
 * - Escape closes; so does leaving the input.
 *
 * Its placeholder is the input's own native attribute: `.empty-placeholder`
 * cannot render on an `<input>`, so there is one placeholder per state.
 */
export function FieldPicker({
  fieldId,
  context,
  field,
  initialQuery = "",
  onReplace,
  onClose,
}: {
  fieldId: string;
  context: FieldContext;
  field: FieldHandle;
  /** What the query starts as: the character typed on a value at rest. */
  initialQuery?: string;
  /** A single-valued field: the pick replaces the value. */
  onReplace: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const anchorRef = useRef<HTMLDivElement>(null);
  const search = refSearchOf(context, fieldId);
  const fieldNode = context.schema.get(fieldId);
  const creation = refCreationOf(context, fieldId);
  const selected = useMemo(
    () => new Set(field.values.flatMap((v) => (v.t === "ref" ? [v.v] : []))),
    [field.values],
  );
  const candidates = useMemo(
    () =>
      orderCandidates(nodeCandidates(search.pool, { allowed: search.allowed }), {
        declared: declaresOptionSet(fieldNode) ? fieldNode?.children : undefined,
        recent: recentPicks(fieldId),
        uses: refUses(context.outline, fieldId),
      }),
    [search.pool, search.allowed, fieldNode, fieldId, context.outline],
  );
  const rows = useMemo(
    () => pickerRows(candidates, { query, selected, canCreate: creation !== null, limit: 50 }),
    [candidates, query, selected, creation],
  );

  const pickId = (id: string) => {
    notePick(fieldId, id);
    if (!field.many) {
      onReplace(id);
      return;
    }
    const value: PropValue = { t: "ref", v: id };
    if (selected.has(id)) field.remove(value);
    else field.add(value);
    setQuery("");
  };

  const pick = (row: PickerRow | null) => {
    if (row?.kind === "item") pickId(row.id);
    else if (row?.kind === "create" && creation !== null) {
      void field.create(creation, row.name).then((id) => {
        if (id !== null) pickId(id);
      });
    }
  };

  const last = field.values.at(-1);
  const keys = usePickerKeys({
    rows,
    query,
    onPick: pick,
    onCancel: onClose,
    onRemoveLast: field.many && last !== undefined ? () => field.remove(last) : undefined,
  });

  return (
    <div ref={anchorRef} className="relative min-w-[8rem] flex-1" data-field-picker={fieldId}>
      <input
        type="text"
        value={query}
        placeholder={creation === null ? "Search…" : "Search or create…"}
        aria-label={`Pick ${textOr(fieldNode?.text, "a value")}`}
        className={inputClass}
        autoFocus
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          // The outline behind this input must not also act on these keys.
          e.stopPropagation();
          keys.handleKeyDown(e);
        }}
        onBlur={onClose}
      />
      <PickerList
        placement="popover"
        anchorRef={anchorRef}
        rows={rows}
        activeIndex={keys.activeIndex}
        onHover={keys.setActiveIndex}
        onPick={pick}
        createLabel={(name) => createLabelOf(creation, context, name)}
        emptyText={query.trim() === "" ? "Nothing to pick yet" : "No matches"}
        hint={field.many ? "↵ toggle · ⌫ remove last · esc done" : "↵ pick · esc close"}
        aria-label={textOr(fieldNode?.text, "Values")}
      />
    </div>
  );
}

/** What the create row offers to make, in the field's words. */
function createLabelOf(creation: RefCreation | null, context: FieldContext, name: string): string {
  if (creation?.kind === "child") return `Create option “${name}”`;
  if (creation?.kind === "tagged") {
    return `Create #${textOr(context.schema.get(creation.tagId)?.text, "tag")} “${name}”`;
  }
  return `Create “${name}”`;
}
