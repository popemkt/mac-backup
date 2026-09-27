import type { FieldContext } from "@/lib/schema";
import type { OutlineNode, PropValue } from "@/lib/types";
import { useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { KB_TEXT_CLASS } from "@/lib/md-inline";
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
import type { ParsedValue } from "@kb/model";
import { WarningIcon } from "@phosphor-icons/react";
import { nodeCandidates, refSearchOf } from "@/lib/refs";
import { pickerRows } from "@/lib/picker";
import { usePickerKeys } from "@/lib/use-picker";
import { TAG_PALETTE } from "@/lib/tag-color";
import { asInstance } from "@/lib/dom";
import { bulletClickIntent, nodeTarget, type Follow, type FollowTarget } from "@/lib/follow";
import type { ValueKindSpec } from "@/lib/value-kind";
import { PickerList } from "@/components/ui/picker-list";
import { Bullet } from "./bullet";
import { NodeRow } from "./node-row";
import { TagChipGroup } from "./tag-chip";
import { hasText } from "@/lib/text";

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
  /** Follow a pointer inside the value: a ref's bullet or tag chip. */
  onFollow: Follow;
}

const editableClass = cn("flex-1 outline-none rounded-sm px-1", KB_TEXT_CLASS);

/**
 * What a caret surface shows at rest: text's inline markdown, a url's link,
 * or the plain string.
 */
export type CaretDisplay = "markdown" | "link" | "plain";

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
  display: shownAs,
}: Omit<ValueSurfaceProps, "display"> & { display: CaretDisplay }) {
  const viewRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
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
      caretAtPoint: (x, y) => {
        // Only a surface whose rest tree is its edit tree can map a point to
        // an offset; a url's short label is not the text it edits.
        const el = viewRef.current;
        if (el === null || shownAs === "link") return "end";
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
  const textClass = cn(editableClass, "kb-md-view min-w-0 cursor-text whitespace-pre-wrap", tone);

  return (
    <div className="flex min-w-0 flex-1 items-start">
      {editing ? (
        <div
          key="edit"
          ref={editRef}
          className={cn(textClass, "editable")}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          data-editable-text="true"
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
          onBlur={finish}
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
          text={showEmpty ? null : text}
          href={shownAs === "link" && rejected === null ? spec.follow(value) : null}
          markdown={shownAs === "markdown" && rejected === null}
          rejected={rejected}
        />
      )}
    </div>
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

export function CheckboxSurface({ value }: ValueSurfaceProps) {
  const on = value.t === "bool" && value.v;
  return (
    <button
      type="button"
      className={cn(
        "relative h-[20px] w-[36px] shrink-0 rounded-full transition-colors duration-150",
        on ? "bg-primary/60" : "bg-foreground/15",
      )}
      aria-pressed={on}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-knob shadow-raised",
          "transition-transform duration-150",
          on && "translate-x-4",
        )}
      />
    </button>
  );
}

export function DateSurface({ value, spec, editing, onEnd }: ValueSurfaceProps) {
  const text = spec.text(value);
  const displayDate = text
    ? new Date(text).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  if (editing) {
    return (
      <input
        type="date"
        className={cn(editableClass, "border-none bg-transparent text-foreground/70")}
        defaultValue={text ? text.slice(0, 10) : ""}
        autoFocus
        onChange={(e) => onEnd(spec.parse(e.target.value), e.target.value)}
        onBlur={() => onEnd()}
      />
    );
  }

  return (
    <span
      className={cn(
        editableClass,
        "cursor-text",
        !hasText(displayDate) && "empty-placeholder text-foreground/25 italic",
      )}
      data-empty-placeholder={!hasText(displayDate) ? "true" : undefined}
    >
      {displayDate ?? ""}
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
 * The open search: an input over the field's allowed targets, with the
 * suggestion list showing from the moment it focuses (no typing required).
 *
 * Its placeholder is the input's own native attribute. `.empty-placeholder`
 * (`:empty::before`) is the mechanism the other surfaces here use, but it
 * cannot render on an `<input>`, so there is exactly one placeholder per state
 * and this is the open one.
 *
 * Ranking is the picker engine's (`pickerRows`) and the keys are
 * `usePickerKeys`; what is left here is the input, the query state that
 * belongs to it, and the two ways a search ends — a pick, and a blur.
 */
function RefSearch({
  fieldId,
  context,
  onCommit,
  onClose,
}: {
  fieldId: string;
  context: FieldContext;
  onCommit: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const search = refSearchOf(context, fieldId);
  const candidates = useMemo(
    () => nodeCandidates(search.pool, { allowed: search.allowed }),
    [search.pool, search.allowed],
  );
  const rows = useMemo(() => pickerRows(candidates, { query, limit: 12 }), [candidates, query]);

  const { activeIndex, setActiveIndex, handleKeyDown } = usePickerKeys({
    rows,
    query,
    onPick: (row) => {
      if (row?.kind === "item") onCommit(row.id);
      // Manual entry still allowed (the list is suggestions-only).
      else if (query.trim()) onCommit(query.trim());
    },
    onCancel: onClose,
  });

  return (
    <div className="relative min-w-0 flex-1">
      <input
        type="text"
        value={query}
        placeholder="Search node…"
        className={cn(
          editableClass,
          "w-full border-none bg-transparent text-foreground/70 placeholder:text-foreground/25",
        )}
        autoFocus
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          // The outline behind this input must not also act on these keys.
          e.stopPropagation();
          handleKeyDown(e);
        }}
        onBlur={() => {
          // Delay so mousedown on suggestion can fire first.
          window.setTimeout(onClose, 120);
        }}
      />
      <PickerList
        placement="popover"
        rows={rows}
        activeIndex={activeIndex}
        onHover={setActiveIndex}
        onPick={(row) => {
          if (row.kind === "item") onCommit(row.id);
        }}
      />
      {/* No `.empty-placeholder` sibling — see the note on RefSearch. */}
    </div>
  );
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
  onEnd,
  onFollow,
}: ValueSurfaceProps) {
  const refId = spec.text(value);
  if (editing) {
    return (
      <RefSearch
        fieldId={fieldId}
        context={context}
        onCommit={(id) => onEnd(spec.parse(id), id)}
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
