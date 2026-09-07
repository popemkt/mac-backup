import {
  CalendarBlankIcon,
  HashIcon,
  LinkSimpleIcon,
  PaletteIcon,
  TextTIcon,
  ToggleRightIcon,
  type Icon,
} from "@phosphor-icons/react";
import type { NodeMap, OutlineNode, PropValue } from "@/lib/types";
import { SYSTEM_IDS } from "@/lib/types";
import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { emptyValueForType, type FieldType } from "@/lib/field-type";
import { KB_TEXT_CLASS } from "@/lib/md-inline";
import { useRefCandidates } from "@/lib/use-ref-candidates";
import { TAG_PALETTE } from "@/lib/tag-color";
import { useOutlineStore } from "@/stores/outline.store"; // GAP [[01M1RXMRJA3ZRAWPTB0ZH5YEYG]]
import { asInstance } from "@/lib/dom";
import { RefAutocomplete } from "@/components/ref-autocomplete";
import { Bullet } from "./bullet";
import { NodeRow } from "./node-row";
import { TagChipGroup } from "./tag-chip";
import { hasText } from "@/lib/text";

/** Everything a field's value needs from the surfaces that show it. */
export interface FieldEditorProps {
  value: PropValue;
  /** Pre-formatted label for a ref value, when the caller already has one. */
  display: string;
  /** When set, ref suggestions are filtered to this id set. */
  allowedRefIds: Set<string> | null;
  /**
   * This slot exists because the user asked for it (⌘"+ value"), so the
   * gesture that created it owns the focus and the editor opens straight away.
   * A slot that exists only because the field is unset passes false and renders
   * as a quiet placeholder until it is focused — see RefEditor.
   */
  autoOpen: boolean;
  onCommit: (next: PropValue) => void;
  nodes: NodeMap;
}

/**
 * One field type's presentation: the glyph its row wears, and the component
 * that both shows the value and edits it in place.
 *
 * Display and edit are one component per type on purpose — every editor here
 * *is* its own display until it is clicked, which is what makes an inline
 * field feel like text rather than a form control.
 */
export interface FieldEditor {
  /** The type glyph `FieldRow` shows in its icon slot. */
  readonly icon: Icon;
  readonly Editor: (props: FieldEditorProps) => React.ReactNode;
}

const editableClass = cn("flex-1 outline-none rounded-sm px-1", KB_TEXT_CLASS);

/**
 * The three textual types differ by data, not by component.
 *
 * `text`, `url` and `number` all edit a contenteditable line. What separates
 * them is the underline, when the line counts as empty, and how the string
 * becomes a `PropValue` — so those are the columns, and the editor is written
 * once.
 */
interface TextualSpec {
  readonly underline: boolean;
  readonly isEmpty: (value: PropValue) => boolean;
  /** `null` rejects the input: the field keeps the value it had. */
  readonly parse: (text: string) => PropValue | null;
}

function textualEditor(spec: TextualSpec): FieldEditor["Editor"] {
  return function TextualEditor({ value, onCommit }: FieldEditorProps) {
    return (
      <EditableText
        text={value.t === "str" ? value.v : String(value.v)}
        empty={spec.isEmpty(value)}
        underline={spec.underline}
        onCommit={(text) => {
          const next = spec.parse(text);
          if (next) onCommit(next);
        }}
      />
    );
  };
}

/** A scalar reads as unset when it holds its type's zero. */
function isBlankScalar(value: PropValue): boolean {
  return value.v === "" || value.v === 0 || value.v === false;
}

function BooleanEditor({ value, onCommit }: FieldEditorProps) {
  return (
    <BooleanValue
      value={value.t === "bool" ? value.v : false}
      onChange={(v) => onCommit({ t: "bool", v })}
    />
  );
}

function DateEditor({ value, autoOpen, onCommit }: FieldEditorProps) {
  return (
    <DateValue
      value={value.t === "str" || value.t === "date" ? value.v : ""}
      autoOpen={autoOpen}
      onChange={(v) => onCommit({ t: "str", v })}
    />
  );
}

function RefFieldEditor({
  value,
  display,
  nodes,
  allowedRefIds,
  autoOpen,
  onCommit,
}: FieldEditorProps) {
  return (
    <RefEditor
      refId={value.t === "ref" ? value.v : ""}
      display={display}
      nodes={nodes}
      allowedRefIds={allowedRefIds}
      autoOpen={autoOpen}
      onCommit={(id) => onCommit({ t: "ref", v: id })}
    />
  );
}

function ColorEditor({ value, onCommit }: FieldEditorProps) {
  return (
    <ColorSwatchEditor
      value={value.t === "str" ? value.v : ""}
      onCommit={(hex) => onCommit({ t: "str", v: hex })}
    />
  );
}

/**
 * The editor registry: one row per declared field type.
 *
 * `FieldRow`, `PropValueEditor` and `EmptyTypedEditor` all read this table —
 * a `switch` in the first two and a leading `if` in all three used to answer
 * the same question three ways. A new field type is a row here; a type that
 * needs something special says so in *its own row*, never in an `if` at a
 * call site.
 *
 * `url` shares the text glyph, as it always has. That is now a cell rather
 * than a fall-through, so giving it its own icon is a one-word change.
 */
const FIELD_EDITORS: Record<FieldType, FieldEditor> = {
  text: {
    icon: TextTIcon,
    Editor: textualEditor({
      underline: false,
      isEmpty: isBlankScalar,
      parse: (text) => ({ t: "str", v: text }),
    }),
  },
  url: {
    icon: TextTIcon,
    Editor: textualEditor({
      underline: true,
      isEmpty: isBlankScalar,
      parse: (text) => ({ t: "str", v: text }),
    }),
  },
  number: {
    icon: HashIcon,
    Editor: textualEditor({
      underline: false,
      isEmpty: (value) => value.t !== "num",
      parse: (text) => {
        const n = Number(text.trim());
        return Number.isNaN(n) ? null : { t: "num", v: n };
      },
    }),
  },
  date: { icon: CalendarBlankIcon, Editor: DateEditor },
  checkbox: { icon: ToggleRightIcon, Editor: BooleanEditor },
  ref: { icon: LinkSimpleIcon, Editor: RefFieldEditor },
};

/**
 * Fields that name their own editor, whatever type they declare.
 *
 * A declared type says what shape the value has; a particular field may still
 * know a better way to pick one. `sys.f.color` stores a hex string — a text
 * field by type — and is edited as palette swatches. One row here replaces the
 * three `if (fieldId === SYSTEM_IDS.colorField)` this was: the editor, the
 * empty slot, and the row's icon.
 */
const FIELD_ID_EDITORS: Readonly<Record<string, FieldEditor>> = {
  [SYSTEM_IDS.colorField]: { icon: PaletteIcon, Editor: ColorEditor },
};

/** The editor a field uses: its own if it names one, else its type's. */
function editorFor(fieldType: FieldType, fieldId?: string): FieldEditor {
  const named = fieldId === undefined ? undefined : FIELD_ID_EDITORS[fieldId];
  return named ?? FIELD_EDITORS[fieldType];
}

/**
 * The type glyph for a field — the icon half of its registry row.
 *
 * `FieldRow` renders this rather than looking the row up itself, so the glyph
 * and the editor can never come from different rows.
 */
export function FieldTypeIcon({
  fieldType,
  fieldId,
  size = 13,
}: {
  fieldType: FieldType;
  fieldId?: string;
  size?: number;
}) {
  const { icon: Glyph } = editorFor(fieldType, fieldId);
  return <Glyph size={size} />;
}

/** Borderless inline prop editor — looked up by field, rendered by type. */
export function PropValueEditor({
  fieldType,
  fieldId,
  allowedRefIds = null,
  autoOpen = false,
  ...rest
}: Omit<FieldEditorProps, "allowedRefIds" | "autoOpen"> & {
  fieldType: FieldType;
  /** Field definition id — lets a field name its own editor (e.g. sys.f.color). */
  fieldId?: string;
  allowedRefIds?: Set<string> | null;
  autoOpen?: boolean;
}) {
  const { Editor } = editorFor(fieldType, fieldId);
  return <Editor {...rest} allowedRefIds={allowedRefIds} autoOpen={autoOpen} />;
}

/** Editor for an empty typed slot (no value yet). */
export function EmptyTypedEditor({
  fieldType,
  fieldId,
  allowedRefIds = null,
  autoOpen = false,
  onCommit,
  nodes,
}: {
  fieldType: FieldType;
  fieldId?: string;
  allowedRefIds?: Set<string> | null;
  autoOpen?: boolean;
  onCommit: (next: PropValue) => void;
  nodes: NodeMap;
}) {
  return (
    <PropValueEditor
      value={emptyValueForType(fieldType)}
      display=""
      fieldType={fieldType}
      fieldId={fieldId}
      allowedRefIds={allowedRefIds}
      autoOpen={autoOpen}
      onCommit={onCommit}
      nodes={nodes}
    />
  );
}

/**
 * Color field editor — palette swatches + optional custom hex.
 * Used for sys.f.color on tag nodes (and any other color field).
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
          "font-mono text-[11px] text-foreground/60 outline-none",
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

function EditableText({
  text,
  onCommit,
  empty,
  underline = false,
}: {
  text: string;
  onCommit: (text: string) => void;
  empty?: boolean;
  underline?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isEditing = useRef(false);
  const isComposing = useRef(false);

  const handleClick = useCallback(() => {
    if (!isEditing.current && ref.current) {
      isEditing.current = true;
      ref.current.contentEditable = "true";
      ref.current.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(ref.current);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, []);

  const commit = useCallback(() => {
    if (!ref.current) return;
    isEditing.current = false;
    ref.current.contentEditable = "false";
    const next = ref.current.textContent;
    if (next !== text) onCommit(next);
  }, [text, onCommit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !isComposing.current && !e.nativeEvent.isComposing) {
        e.preventDefault();
        ref.current?.blur();
      }
      if (e.key === "Escape") {
        if (ref.current) ref.current.textContent = text;
        ref.current?.blur();
      }
      e.stopPropagation();
    },
    [text],
  );

  const showEmpty = empty === true && !text;

  return (
    <div
      ref={ref}
      className={cn(
        editableClass,
        "cursor-text",
        showEmpty && "empty-placeholder",
        showEmpty
          ? "text-foreground/25 italic"
          : underline
            ? "text-primary underline underline-offset-2 decoration-primary/20"
            : "text-foreground/70",
      )}
      onClick={handleClick}
      onBlur={commit}
      onKeyDown={handleKeyDown}
      data-editable-text="true"
      data-empty-placeholder={showEmpty ? "true" : undefined}
      onCompositionStart={() => {
        isComposing.current = true;
      }}
      onCompositionEnd={() => {
        isComposing.current = false;
      }}
      suppressContentEditableWarning
    >
      {/* D17: empty state is CSS-only (:empty::before) — the DOM stays
          empty so the caret lands on a truly blank editor. */}
      {showEmpty ? "" : text}
    </div>
  );
}

function BooleanValue({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={cn(
        "relative h-[20px] w-[36px] shrink-0 rounded-full transition-colors duration-150",
        value ? "bg-primary/60" : "bg-foreground/15",
      )}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!value);
      }}
      aria-pressed={value}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm",
          "transition-transform duration-150",
          value && "translate-x-4",
        )}
      />
    </button>
  );
}

function DateValue({
  value,
  autoOpen = false,
  onChange,
}: {
  value: string;
  autoOpen?: boolean;
  onChange: (v: string) => void;
}) {
  // Same rule as RefEditor: mount open only when a gesture created this slot.
  const [editing, setEditing] = useState(autoOpen);

  const displayDate = value
    ? new Date(value).toLocaleDateString("en-US", {
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
        defaultValue={value ? value.slice(0, 10) : ""}
        autoFocus
        onChange={(e) => {
          onChange(e.target.value);
          setEditing(false);
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => e.stopPropagation()}
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
      onClick={() => setEditing(true)}
    >
      {displayDate ?? ""}
    </span>
  );
}

/** A resolved ref: the target's own row, clickable into the search. */
function ResolvedRefRow({
  refId,
  target,
  onOpen,
}: {
  refId: string;
  target: OutlineNode;
  onOpen: () => void;
}) {
  const zoomTo = useOutlineStore((s) => s.zoomTo);
  return (
    <NodeRow
      depth={0}
      nodeId={refId}
      className="cursor-pointer"
      onRowClick={onOpen}
      bullet={
        <Bullet
          node={{ ...target, collapsed: true }}
          isRef
          onClick={(e) => {
            e.stopPropagation();
            zoomTo(refId);
          }}
        />
      }
      content={
        <>
          <span
            className={cn(KB_TEXT_CLASS, "min-w-0 flex-1 truncate text-foreground/70")}
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
          >
            {/* A resolved target's own text is the label; the caller's
                `display` is only ever a fallback for an *un*resolved id. */}
            {target.text || "\u200B"}
          </span>
          {target.tags.length > 0 && (
            <TagChipGroup
              tags={target.tags}
              onTagClick={(tag, e) => {
                e.stopPropagation();
                zoomTo(tag.id);
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
function UnresolvedRefChip({
  refId,
  display,
  onOpen,
}: {
  refId: string;
  display: string;
  onOpen: () => void;
}) {
  const hasDisplay = Boolean(display && display !== refId);
  return (
    <span
      className={cn(
        "inline-flex cursor-pointer items-center gap-1 rounded-sm px-1.5 py-px",
        "kb-text text-foreground/70",
        hasDisplay ? "bg-primary/8 hover:bg-primary/12" : "bg-warning/10 hover:bg-warning/15",
        "transition-colors duration-100",
      )}
      onClick={onOpen}
      title={hasDisplay ? `Node: ${refId}` : `Unresolved ref: ${refId}`}
      data-unresolved-ref={!hasDisplay ? "true" : undefined}
    >
      {!hasDisplay && <span className="text-warning text-[11px] leading-none">⚠</span>}
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
 * An unset slot nobody asked for: the quiet placeholder every other editor
 * here shows, focusable so the search opens the moment it is aimed at — by
 * click, by Tab, or by anything else that moves focus.
 */
function EmptyRefSlot({ onOpen }: { onOpen: () => void }) {
  return (
    <span
      tabIndex={0}
      role="button"
      aria-label="Set reference"
      className={cn(editableClass, "cursor-text italic empty-placeholder text-foreground/25")}
      data-empty-placeholder="true"
      data-ref-slot="closed"
      onFocus={onOpen}
      onClick={onOpen}
    />
  );
}

/**
 * The open search: an input over the field's allowed targets, with the
 * suggestion list showing from the moment it focuses (no typing required).
 *
 * Its placeholder is the input's own native attribute. `.empty-placeholder`
 * (`:empty::before`) is the mechanism the other editors here use, but it
 * cannot render on an `<input>`, so there is exactly one placeholder per state
 * and this is the open one.
 *
 * Ranking and key handling are `useRefCandidates`; what is left here is the
 * markup, the query state that belongs to this input, and the two ways a
 * search ends — a mousedown on a suggestion, and a blur.
 */
function RefSearch({
  nodes,
  allowedRefIds,
  onCommit,
  onClose,
}: {
  nodes: NodeMap;
  allowedRefIds: Set<string> | null;
  onCommit: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

  const commit = (id: string) => {
    onCommit(id);
    setQuery("");
    onClose();
  };

  const { candidates, activeIndex, handleKeyDown } = useRefCandidates({
    nodes,
    query,
    allowed: allowedRefIds,
    onPick: (candidate) => {
      if (candidate) commit(candidate.id);
      // Manual entry still allowed (the list is suggestions-only).
      else if (query.trim()) commit(query.trim());
    },
    onCancel: () => {
      setQuery("");
      onClose();
    },
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
          window.setTimeout(() => {
            setQuery("");
            onClose();
          }, 120);
        }}
      />
      {candidates.length > 0 && (
        <RefAutocomplete
          candidates={candidates}
          activeIndex={activeIndex}
          onSelect={(c) => commit(c.id)}
        />
      )}
      {/* No `.empty-placeholder` sibling — see the note on RefSearch. */}
    </div>
  );
}

/**
 * Ref value editor: one of four states, and the rule for which.
 *
 * **Focus belongs to the gesture that created the slot, not to the slot being
 * empty.** `useState(!refId)` meant every unset ref field on a page mounted
 * already open, so a page of empty option fields opened every dropdown at once
 * and several `autoFocus` inputs fought over the caret with outline keyboard
 * navigation. An unset slot renders as a quiet placeholder and opens when it
 * *receives focus*; `autoOpen` (threaded down from FieldValueStack, the only
 * component that knows which kind of slot this is) opens the ones the user
 * minted with "+ value". Openness is therefore one state, driven by focus —
 * blur closes it — which is also what keeps the dropdown from rendering under
 * an input nobody is typing in.
 *
 * `allowedRefIds` is an *input* to candidate resolution, never a filter over
 * its output — lib/refs owns membership, and a field's declared targets outrank
 * its hide-infrastructure heuristic.
 */
function RefEditor({
  refId,
  display,
  nodes,
  allowedRefIds = null,
  autoOpen = false,
  onCommit,
}: {
  refId: string;
  display: string;
  nodes: NodeMap;
  allowedRefIds?: Set<string> | null;
  autoOpen?: boolean;
  onCommit: (id: string) => void;
}) {
  const [open, setOpen] = useState(autoOpen);
  const target = nodes.get(refId);

  if (open) {
    return (
      <RefSearch
        nodes={nodes}
        allowedRefIds={allowedRefIds}
        onCommit={onCommit}
        onClose={() => setOpen(false)}
      />
    );
  }
  const show = () => setOpen(true);
  if (target) {
    return <ResolvedRefRow refId={refId} target={target} onOpen={show} />;
  }
  if (refId) return <UnresolvedRefChip refId={refId} display={display} onOpen={show} />;
  return <EmptyRefSlot onOpen={show} />;
}
