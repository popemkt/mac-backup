import type { FieldContext } from "@/lib/schema";
import type { OutlineNode, PropValue } from "@/lib/types";
import { useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { KB_TEXT_CLASS } from "@/lib/md-inline";
import { textOr } from "@/lib/text";
import {
  INLINE_TEXT_CLASSES,
  KB_REF_ID_ATTR,
  getCaretSerializedOffset,
  readInlineInput,
  renderInlineMarkdown,
  revealMarkupAtSelection,
  serializeEditable,
  setCaretSerializedOffset,
} from "@/lib/md-edit";
import { offsetFromPoint } from "@/lib/caret";
import { InlineMarkdown } from "@/components/ui/md-view";
import { useRevealMarkup } from "@/components/ui/use-reveal-markup";
import { urlLabel } from "@/lib/url-label";
import { formatNumber } from "@/lib/number-format";
import { declaresOptionSet, parseDateInput, parseDay, type ParsedValue } from "@kb/model";
import { longDateLabel, relativeDateLabel } from "@/lib/date-display";
import { DateEditor } from "@/components/ui/date-editor";
import { CheckIcon, WarningIcon } from "@phosphor-icons/react";
import { nodeCandidates, refCreationOf, refSearchOf, refUses, type RefCreation } from "@/lib/refs";
import { notePick, recentPicks } from "@/lib/picker-recency";
import { orderCandidates, pickerRows, type PickerRow } from "@/lib/picker";
import { usePickerKeys } from "@/lib/use-picker";
import { optionColorOf, TAG_PALETTE } from "@/lib/tag-color";
import { asInstance } from "@/lib/dom";
import { bulletClickIntent, nodeTarget, type Follow, type FollowTarget } from "@/lib/follow";
import type { ValueKindSpec } from "@/lib/value-kind";
import { PickerList } from "@/components/ui/picker-list";
import { Bullet } from "./bullet";
import { NodeRow } from "./node-row";
import { OptionChip, TagChipGroup } from "./tag-chip";

/**
 * What a slot's keymap asks of the editor it holds. Only a caret editor has
 * one: the other editors own their keys (`EDITOR_MODES[…].keys`).
 */
export interface EditHandle {
  /** Enter: keep what was typed and leave the editor. */
  commit: () => void;
  /** Escape: put the value back and leave the editor. */
  cancel: () => void;
  /** Shift+Enter: a line break inside the value (text only). */
  softBreak: () => void;
  /** The caret is at the end of a text that is not empty. */
  atEnd: () => boolean;
  /**
   * Where a click at a point lands in the text, measured on the value at
   * rest — before the slot swaps it for the editor.
   */
  caretAtPoint: (x: number, y: number) => number | "end";
}

/** Input a kind refused, and why. */
export interface RejectedInput {
  readonly text: string;
  readonly reason: string;
}

/** Everything a kind's surface is handed by the slot that holds it. */
export interface ValueSurfaceProps {
  /** The stored value, or the type's empty value when the slot holds none. */
  value: PropValue;
  /** The slot shows its placeholder rather than the value. */
  blank: boolean;
  /** The slot's editor is open (`ValueSlot` owns this state). */
  editing: boolean;
  /** Where a caret editor opens: the click's offset, or the end. */
  caretAt: number | "end";
  spec: ValueKindSpec;
  /** Pre-formatted label for a ref value, when the caller already has one. */
  display: string;
  /** The field this value belongs to; a ref field's option set is its own. */
  fieldId: string;
  /**
   * What the value resolves against (`fieldContextOf`). A ref editor derives
   * its option set and where it searches from this and `fieldId` itself
   * (`refSearchOf`), so no surface passes, or can forget, either.
   */
  context: FieldContext;
  /** Text the kind could not read, kept so it is never dropped (`CaretValue`). */
  rejected: RejectedInput | null;
  /**
   * Leave the editor. With a parse, commit what it read — or, when it read
   * nothing, keep `text` as rejected input; without one, nothing changed.
   */
  onEnd: (parsed?: ParsedValue, text?: string) => void;
  /** Where a caret surface exposes itself to the slot's keymap. */
  handleRef: React.Ref<EditHandle>;
  /** The field the value belongs to, as a whole (a picker edits it). */
  field: FieldHandle;
  /** What an empty value says while it waits (`data-placeholder`). */
  placeholder?: string;
  /** Follow a pointer inside the value: a ref's bullet or tag chip. */
  onFollow: Follow;
}

const editableClass = cn("flex-1 outline-none rounded-sm px-1", KB_TEXT_CLASS);

/**
 * What a caret surface shows at rest: text's inline markdown, a url's link,
 * or a number grouped in the locale's separators.
 */
export type CaretDisplay = "markdown" | "link" | "number";

/**
 * A value that is text, edited in place by the same live preview node text
 * uses (DESIGN-UI.md → Node text is one surface): at rest the value is its
 * inline tree, and editing makes that tree contentEditable with the caret
 * where the click landed and the markup under the caret revealed. Typing is
 * read back through `readInlineInput`, so `**b**`, links and `[[ref]]` pills
 * format and follow exactly as they do in node text. A url and a number are
 * the same surface with a plain display: the url is a link at rest, and
 * neither has formatting to reveal.
 *
 * Text the kind cannot read is never dropped: the slot keeps it (`rejected`),
 * this shows it marked with the reason, and the next edit starts from it.
 */
export function CaretValue({
  value,
  blank,
  editing,
  caretAt,
  spec,
  rejected,
  onEnd,
  handleRef,
  placeholder,
  display: shownAs,
}: Omit<ValueSurfaceProps, "display"> & { display: CaretDisplay }) {
  const viewRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLDivElement>(null);
  const stored = spec.text(value);
  const text = rejected?.text ?? stored;

  useLayoutEffect(() => {
    const el = editRef.current;
    if (!editing || el === null) return;
    renderInlineMarkdown(el, text);
    el.focus();
    setCaretSerializedOffset(el, caretAt === "end" ? text.length : Math.min(caretAt, text.length));
    revealMarkupAtSelection(el);
    // Entering is the only time the DOM is built from `text`: while editing,
    // the DOM is the text.
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- rebuilt on entry only
  }, [editing]);

  useRevealMarkup(editRef, editing);

  useImperativeHandle(
    handleRef,
    () => ({
      commit: () => editRef.current?.blur(),
      cancel: () => {
        if (editRef.current) renderInlineMarkdown(editRef.current, stored);
        editRef.current?.blur();
      },
      softBreak: () => {
        const el = editRef.current;
        if (el === null || shownAs !== "markdown") return;
        const current = serializeEditable(el);
        const at = getCaretSerializedOffset(el);
        renderInlineMarkdown(el, `${current.slice(0, at)}\n${current.slice(at)}`);
        setCaretSerializedOffset(el, at + 1);
        revealMarkupAtSelection(el);
      },
      atEnd: () => {
        const el = editRef.current;
        if (el === null) return false;
        const typed = serializeEditable(el);
        return typed.trim() !== "" && getCaretSerializedOffset(el) >= typed.length;
      },
      caretAtPoint: (x, y) => {
        // Only a surface whose rest tree is its edit tree can map a point to
        // an offset; a url's short label and a grouped number are not the
        // text they edit.
        const el = viewRef.current;
        if (el === null || shownAs === "link" || shownAs === "number") return "end";
        return offsetFromPoint(el, x, y) ?? "end";
      },
    }),
    [stored, shownAs],
  );

  const finish = () => {
    const next = editRef.current === null ? text : serializeEditable(editRef.current);
    if (next === stored) onEnd();
    else onEnd(spec.parse(next), next);
  };

  const showEmpty = blank && !text;
  const tone = showEmpty
    ? "text-foreground/25 italic"
    : rejected !== null
      ? "text-warning underline decoration-wavy decoration-warning/50 underline-offset-2"
      : "text-foreground/70";
  const textClass = cn(
    editableClass,
    "kb-md-view min-w-0 cursor-text whitespace-pre-wrap",
    shownAs === "number" && "tabular-nums",
    tone,
  );

  return (
    <div className="flex min-w-0 flex-1 items-start">
      {editing ? (
        <CaretEditor
          editRef={editRef}
          placeholder={placeholder}
          className={cn(textClass, "editable")}
          onFinish={finish}
          onPaste={(e) => {
            // A link pasted into an empty url slot is the whole gesture.
            const pasted = e.clipboardData.getData("text/plain").trim();
            if (shownAs !== "link" || !showEmpty || pasted === "" || /\n/.test(pasted)) return;
            e.preventDefault();
            onEnd(spec.parse(pasted), pasted);
          }}
        />
      ) : (
        <CaretRest
          viewRef={viewRef}
          className={cn(textClass, showEmpty && "empty-placeholder")}
          text={
            showEmpty
              ? null
              : shownAs === "number" && rejected === null && value.t === "num"
                ? formatNumber(value.v)
                : text
          }
          href={shownAs === "link" && rejected === null ? spec.follow(value) : null}
          markdown={shownAs === "markdown" && rejected === null}
          rejected={rejected}
        />
      )}
    </div>
  );
}

/**
 * A caret value while it edits: the inline tree made contentEditable, typing
 * read back through `readInlineInput` (outside an IME composition).
 */
function CaretEditor({
  editRef,
  placeholder,
  className,
  onFinish,
  onPaste,
}: {
  editRef: React.RefObject<HTMLDivElement | null>;
  placeholder: string | undefined;
  className: string;
  onFinish: () => void;
  onPaste: (e: React.ClipboardEvent<HTMLDivElement>) => void;
}) {
  const composing = useRef(false);
  return (
    <div
      key="edit"
      ref={editRef}
      className={className}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      data-editable-text="true"
      data-placeholder={placeholder}
      onInput={() => {
        if (editRef.current && !composing.current) readInlineInput(editRef.current);
      }}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
        if (editRef.current) readInlineInput(editRef.current);
      }}
      onBlur={onFinish}
      onPaste={onPaste}
    />
  );
}

/**
 * A caret value at rest: its inline tree (text), its link (url) or its plain
 * string, or — refused input — that input marked with the reason.
 */
function CaretRest({
  viewRef,
  className,
  text,
  href,
  markdown,
  rejected,
}: {
  viewRef: React.Ref<HTMLDivElement>;
  className: string;
  /** Null: the slot is unset and shows its placeholder. */
  text: string | null;
  href: FollowTarget | null;
  markdown: boolean;
  rejected: RejectedInput | null;
}) {
  return (
    <>
      <div
        key="view"
        ref={viewRef}
        className={className}
        data-editable-text="true"
        data-empty-placeholder={text === null ? "true" : undefined}
        data-rejected={rejected !== null ? "true" : undefined}
        aria-invalid={rejected !== null || undefined}
        title={rejected?.reason}
      >
        {/* D17: empty state is CSS-only (:empty::before) — the DOM stays
            empty so the caret lands on a truly blank editor. */}
        {text === null ? null : href?.kind === "href" ? (
          <UrlLink href={href.href} />
        ) : markdown ? (
          <InlineMarkdown text={text} />
        ) : (
          text
        )}
      </div>
      {rejected !== null && (
        <span
          className="flex h-6 w-4 shrink-0 items-center justify-center text-warning"
          title={rejected.reason}
          data-mismatch-warning="true"
        >
          <WarningIcon size={11} weight="fill" aria-hidden />
        </span>
      )}
    </>
  );
}

/**
 * A url value at rest: a real anchor, so the browser's own open, middle-click,
 * status-bar preview and "Copy link" all work. The label is short and capped
 * below the slot's width, so there is always space beside it to click into
 * the value; the full url is the title.
 */
function UrlLink({ href }: { href: string }) {
  return (
    <a
      className={cn(
        INLINE_TEXT_CLASSES.link,
        "inline-block max-w-[60%] truncate align-bottom text-primary",
        "underline decoration-primary/25 underline-offset-2 hover:decoration-primary/60",
      )}
      href={href}
      title={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {urlLabel(href)}
    </a>
  );
}

/**
 * A checkbox value: a real checkbox, not a switch (a switch reads as a device
 * setting). The slot owns the toggle; this is a button so it is a Tab stop
 * and Space or Enter activate it. Unset and off look the same.
 */
export function CheckboxSurface({ value }: ValueSurfaceProps) {
  const on = value.t === "bool" && value.v;
  return (
    <span className="flex h-6 items-center px-1">
      <button
        type="button"
        role="checkbox"
        aria-checked={on}
        aria-label={on ? "Checked" : "Unchecked"}
        className={cn(
          "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-xs border",
          "transition-colors duration-100 outline-none",
          "focus-visible:ring-2 focus-visible:ring-primary/60",
          on
            ? "border-primary/70 bg-primary/10 text-primary"
            : "border-foreground/25 hover:border-foreground/45",
        )}
      >
        {on && <CheckIcon size={10} weight="bold" aria-hidden />}
      </button>
    </span>
  );
}

/**
 * A date value: at rest its label near today (`Today`, `Fri`, `Oct 12`),
 * read from its local calendar day, with the full date as the title; while
 * the slot edits, the date editor — typed phrases or the calendar — seeded
 * with the stored date, or with input the slot kept.
 */
export function DateSurface({ value, spec, editing, rejected, onEnd }: ValueSurfaceProps) {
  const stored = spec.text(value);
  // A stored date in an older form (an ISO timestamp) still reads as its day.
  const canonical = stored === "" ? "" : (parseDateInput(stored) ?? stored);
  const date = parseDay(canonical);

  if (editing) {
    return (
      <DateEditor
        initialText={rejected?.text ?? canonical}
        onCommit={(text) => onEnd(spec.parse(text), text)}
        onCancel={() => onEnd()}
      />
    );
  }

  const shown = rejected?.text ?? (date === null ? stored : relativeDateLabel(date));
  return (
    <span className="flex min-w-0 items-start">
      <span
        className={cn(
          editableClass,
          "cursor-text tabular-nums",
          shown === ""
            ? "empty-placeholder text-foreground/25 italic"
            : rejected !== null
              ? "text-warning underline decoration-wavy decoration-warning/50 underline-offset-2"
              : "text-foreground/70",
        )}
        data-empty-placeholder={shown === "" ? "true" : undefined}
        data-rejected={rejected !== null ? "true" : undefined}
        title={rejected?.reason ?? (date === null ? undefined : longDateLabel(date))}
      >
        {shown}
      </span>
      {rejected !== null && (
        <span
          className="flex h-6 w-4 shrink-0 items-center justify-center text-warning"
          title={rejected.reason}
          data-mismatch-warning="true"
        >
          <WarningIcon size={11} weight="fill" aria-hidden />
        </span>
      )}
    </span>
  );
}

export function ColorSurface({ value, spec, onEnd }: ValueSurfaceProps) {
  return (
    <ColorSwatchEditor value={spec.text(value)} onCommit={(hex) => onEnd(spec.parse(hex), hex)} />
  );
}

/**
 * Color field editor — palette swatches + optional custom hex.
 * Used for sys.f.color on tag schema (and any other color field).
 */
export function ColorSwatchEditor({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (hex: string) => void;
}) {
  const current = value.trim();
  const [custom, setCustom] = useState(current);

  return (
    <div
      className="flex min-h-6 flex-wrap items-center gap-1 py-0.5"
      data-color-swatch-editor="true"
      role="group"
      aria-label="Color"
    >
      {TAG_PALETTE.map((hex) => {
        const selected = current.toLowerCase() === hex.toLowerCase();
        return (
          <button
            key={hex}
            type="button"
            title={hex}
            aria-label={`Set color ${hex}`}
            aria-pressed={selected}
            className={cn(
              "h-4 w-4 shrink-0 rounded-sm border transition-shadow",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
              selected
                ? "border-foreground/50 ring-2 ring-primary/40"
                : "border-foreground/15 hover:border-foreground/35",
            )}
            style={{ backgroundColor: hex }}
            onClick={() => {
              setCustom(hex);
              onCommit(hex);
            }}
          />
        );
      })}
      <input
        type="text"
        value={custom}
        spellCheck={false}
        placeholder="#hex"
        aria-label="Custom color hex"
        className={cn(
          "ml-1 h-5 w-[5.5rem] rounded-sm border border-foreground/10 bg-transparent px-1",
          "font-mono text-label text-foreground/60 outline-none",
          "placeholder:text-foreground/25 focus:border-foreground/25",
        )}
        onChange={(e) => setCustom(e.target.value)}
        onBlur={() => {
          const next = custom.trim();
          if (/^#[0-9a-fA-F]{3,8}$/.test(next) && next !== current) {
            onCommit(next);
          } else {
            setCustom(current);
          }
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            asInstance(e.target, HTMLElement)?.blur();
          }
        }}
      />
    </div>
  );
}

/** A resolved ref: the target's own row. Activating the slot opens the search. */
function ResolvedRefRow({
  refId,
  target,
  onFollow,
}: {
  refId: string;
  target: OutlineNode;
  onFollow: Follow;
}) {
  return (
    <NodeRow
      depth={0}
      nodeId={refId}
      className="cursor-pointer"
      bullet={
        <Bullet
          node={{ ...target, collapsed: true }}
          isRef
          onClick={(e) => {
            e.stopPropagation();
            // A value's bullet has nothing of its own to expand, so it follows.
            if (bulletClickIntent(e, false) === "follow") onFollow(nodeTarget(refId), "open");
          }}
        />
      }
      content={
        <>
          {/* The label is a pointer segment: a plain click follows it, the
              way a `[[ref]]` pill does. The rest of the row edits the value.
              A resolved target's own text is the label; the caller's
              `display` is only ever a fallback for an *un*resolved id. */}
          <span
            className={cn(
              KB_TEXT_CLASS,
              "min-w-0 cursor-pointer truncate text-foreground/70 hover:underline",
              "decoration-foreground/25 underline-offset-2",
            )}
            {...{ [KB_REF_ID_ATTR]: refId }}
          >
            {target.text || "​"}
          </span>
          {target.tags.length > 0 && (
            <TagChipGroup
              tags={target.tags}
              onTagClick={(tag, e) => {
                e.stopPropagation();
                onFollow(nodeTarget(tag.id), "open");
              }}
            />
          )}
        </>
      }
    />
  );
}

/**
 * A ref whose target is not in the graph.
 *
 * A display label makes it a known node rendered by label — the chip stays
 * quiet. Without one there is nothing to show but the id, and that is what the
 * warning glyph is for: a specific unresolved id, not a generic complaint.
 */
function UnresolvedRefChip({ refId, display }: { refId: string; display: string }) {
  const hasDisplay = Boolean(display && display !== refId);
  return (
    <span
      className={cn(
        "inline-flex cursor-pointer items-center gap-1 rounded-sm px-1.5 py-px",
        "kb-text text-foreground/70",
        hasDisplay ? "bg-primary/8 hover:bg-primary/12" : "bg-warning/10 hover:bg-warning/15",
        "transition-colors duration-100",
      )}
      title={hasDisplay ? `Node: ${refId}` : `Unresolved ref: ${refId}`}
      data-unresolved-ref={!hasDisplay ? "true" : undefined}
    >
      {!hasDisplay && <span className="text-warning text-label leading-none">⚠</span>}
      <span
        className={cn(
          "h-1 w-1 shrink-0 rounded-full",
          hasDisplay ? "bg-foreground/35" : "bg-warning/60",
        )}
      />
      <span className="max-w-[200px] truncate">{hasDisplay ? display : refId}</span>
    </span>
  );
}

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
  /** Open the field's picker, for a many-valued field (the stack draws it). */
  openPicker: () => void;
  /** Open an empty slot for the next value, after the last. */
  addSlot: () => void;
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
        className={cn(
          editableClass,
          "w-full border-none bg-transparent text-foreground/70 placeholder:text-foreground/25",
        )}
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

/**
 * A ref value: one of four states. While the slot edits, the search; at rest,
 * the target's row, the unresolved chip, or the quiet placeholder of an unset
 * slot, which the slot opens when it receives focus (`opensOnFocusWhenEmpty`).
 *
 * The field's declared targets are an *input* to candidate resolution, never
 * a filter over its output — lib/refs owns membership (`refSearchOf`), and a
 * field's declared targets outrank its hide-infrastructure heuristic.
 */
export function RefSurface({
  value,
  spec,
  editing,
  display,
  fieldId,
  context,
  field,
  onEnd,
  onFollow,
}: ValueSurfaceProps) {
  const refId = spec.text(value);
  if (editing) {
    return (
      <FieldPicker
        fieldId={fieldId}
        context={context}
        field={field}
        onReplace={(id) => onEnd(spec.parse(id), id)}
        onClose={() => onEnd()}
      />
    );
  }
  const target = context.schema.get(refId);
  if (target) return <ResolvedRefRow refId={refId} target={target} onFollow={onFollow} />;
  if (refId) return <UnresolvedRefChip refId={refId} display={display} />;
  return (
    <span
      className={cn(editableClass, "block cursor-text italic empty-placeholder text-foreground/25")}
      data-empty-placeholder="true"
      data-ref-slot="closed"
    />
  );
}

/**
 * An option value: a node picked from its field's own list, drawn as the chip
 * a tag is drawn as, in the option's colour (`optionColorOf`). The chip is a
 * pointer segment — a plain click opens the option's page — and the slot
 * around it edits, opening the same picker a ref value uses.
 */
export function OptionSurface({
  value,
  spec,
  editing,
  display,
  fieldId,
  context,
  field,
  onEnd,
}: ValueSurfaceProps) {
  const optionId = spec.text(value);
  if (editing) {
    return (
      <FieldPicker
        fieldId={fieldId}
        context={context}
        field={field}
        onReplace={(id) => onEnd(spec.parse(id), id)}
        onClose={() => onEnd()}
      />
    );
  }
  const option = context.schema.get(optionId);
  if (option) {
    return (
      <span className="flex h-6 items-center px-1">
        <OptionChip
          id={optionId}
          label={option.text || optionId}
          color={optionColorOf(option, context.schema.get(fieldId))}
        />
      </span>
    );
  }
  if (optionId) return <UnresolvedRefChip refId={optionId} display={display} />;
  return (
    <span
      className={cn(editableClass, "block cursor-text italic empty-placeholder text-foreground/25")}
      data-empty-placeholder="true"
      data-ref-slot="closed"
    />
  );
}
