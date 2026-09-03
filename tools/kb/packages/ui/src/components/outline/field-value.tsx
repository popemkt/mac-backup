import type { PropValue, NodeMap } from "@/lib/types";
import { SYSTEM_IDS } from "@/lib/types";
import { useCallback, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { emptyValueForType, type FieldType } from "@/lib/field-type";
import { KB_TEXT_CLASS } from "@/lib/md-inline";
import { fuzzyNodeCandidates } from "@/lib/refs";
import { TAG_PALETTE } from "@/lib/tag-color";
import { useOutlineStore } from "@/stores/outline.store";
import { RefAutocomplete } from "@/components/ref-autocomplete";
import { Bullet } from "./bullet";
import { NodeRow } from "./node-row";
import { TagChipGroup } from "./tag-chip";

interface PropValueEditorProps {
  value: PropValue;
  display: string;
  fieldType: FieldType;
  /** Field definition id — special-cases editors (e.g. sys.f.color swatch). */
  fieldId?: string;
  /** When set, ref suggestions are filtered to this id set. */
  allowedRefIds?: Set<string> | null;
  /**
   * This slot exists because the user asked for it (⌘"+ value"), so the
   * gesture that created it owns the focus and the editor opens straight away.
   * A slot that exists only because the field is unset passes false and renders
   * as a quiet placeholder until it is focused — see RefEditor.
   */
  autoOpen?: boolean;
  onCommit: (next: PropValue) => void;
  nodes: NodeMap;
}

const editableClass = cn("flex-1 outline-none rounded-sm px-1", KB_TEXT_CLASS);

/** Borderless inline prop editors — picked by declared fieldType. */
// oxlint-disable-next-line complexity -- GAP [[01M1MGCND3KMDYJPSSMD2E4Q9J]]
export function PropValueEditor({
  value,
  display,
  fieldType,
  fieldId,
  allowedRefIds = null,
  autoOpen = false,
  onCommit,
  nodes,
}: PropValueEditorProps) {
  if (fieldId === SYSTEM_IDS.colorField) {
    return (
      <ColorSwatchEditor
        value={value.t === "str" ? value.v : ""}
        onCommit={(hex) => onCommit({ t: "str", v: hex })}
      />
    );
  }

  switch (fieldType) {
    case "checkbox":
      return (
        <BooleanValue
          value={value.t === "bool" ? value.v : false}
          onChange={(v) => onCommit({ t: "bool", v })}
        />
      );
    case "number":
      return (
        <EditableText
          text={value.t === "num" ? String(value.v) : String(value.v ?? "")}
          onCommit={(text) => {
            const n = Number(text.trim());
            if (!Number.isNaN(n)) onCommit({ t: "num", v: n });
          }}
          empty={value.t !== "num" || value.v === null || value.v === undefined}
        />
      );
    case "date":
      return (
        <DateValue
          value={value.t === "str" || value.t === "date" ? value.v : ""}
          autoOpen={autoOpen}
          onChange={(v) => onCommit({ t: "str", v })}
        />
      );
    case "url":
      return (
        <EditableText
          text={value.t === "str" ? value.v : String(value.v ?? "")}
          onCommit={(text) => onCommit({ t: "str", v: text })}
          empty={!value.v}
          underline
        />
      );
    case "ref":
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
    case "text":
    default:
      return (
        <EditableText
          text={value.t === "str" ? (value.v ?? "") : String(value.v ?? "")}
          onCommit={(text) => onCommit({ t: "str", v: text })}
          empty={!value.v}
          underline={false}
        />
      );
  }
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
  if (fieldId === SYSTEM_IDS.colorField) {
    return <ColorSwatchEditor value="" onCommit={(hex) => onCommit({ t: "str", v: hex })} />;
  }
  const starter = emptyValueForType(fieldType);
  return (
    <PropValueEditor
      value={starter}
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
            (e.target as HTMLInputElement).blur();
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
    const next = ref.current.textContent ?? "";
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

  const showEmpty = empty && !text;

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
        !displayDate && "empty-placeholder text-foreground/25 italic",
      )}
      data-empty-placeholder={!displayDate ? "true" : undefined}
      onClick={() => setEditing(true)}
    >
      {displayDate ?? ""}
    </span>
  );
}

/**
 * Ref value editor: a search input over the field's allowed targets, with the
 * suggestion list open from the moment it focuses (no typing required).
 *
 * Three rules live here.
 *
 * `allowedRefIds` is an *input* to candidate resolution, never a filter over
 * its output — lib/refs owns membership, and a field's declared targets outrank
 * its hide-infrastructure heuristic.
 *
 * The open editor's placeholder is the input's own native attribute:
 * `.empty-placeholder` (`:empty::before`) is the mechanism the other editors
 * here use, but it cannot render on an `<input>`, so there is exactly one
 * placeholder per state and this is the open one.
 *
 * **Focus belongs to the gesture that created the slot, not to the slot being
 * empty.** `useState(!refId)` meant every unset ref field on a page mounted
 * already open, so a page of empty option fields opened every dropdown at once
 * and several `autoFocus` inputs fought over the caret with outline keyboard
 * navigation. An unset slot now renders as a quiet placeholder and opens when
 * it *receives focus*; `autoOpen` (threaded down from FieldValueStack, the only
 * component that knows which kind of slot this is) opens the ones the user
 * minted with "+ value". Openness is therefore one state, driven by focus —
 * blur closes it — which is also what keeps the dropdown from rendering under
 * an input nobody is typing in.
 */
// oxlint-disable-next-line complexity -- GAP [[01M1MGCP1EF5GM8NA32JEJRJ9Q]]
function RefEditor({
  refId,
  display,
  nodes,
  allowedRefIds,
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
  const zoomTo = useOutlineStore((s) => s.zoomTo);
  const [open, setOpen] = useState(autoOpen);
  const [query, setQuery] = useState("");
  const [acIndex, setAcIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const candidates = useMemo(
    () => fuzzyNodeCandidates(nodes, query, { allowed: allowedRefIds }),
    [nodes, query, allowedRefIds],
  );

  const target = nodes.get(refId);
  const resolvedLabel = target?.text ?? display;

  if (!open && target) {
    return (
      <NodeRow
        depth={0}
        nodeId={refId}
        className="cursor-pointer"
        onRowClick={() => setOpen(true)}
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
                setOpen(true);
              }}
            >
              {resolvedLabel || target.text || "\u200B"}
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
  // Unresolved ref: show warning glyph + resolved or raw id, not a generic warning.
  if (!open && refId && !target) {
    const hasDisplay = Boolean(display && display !== refId);
    return (
      <span
        className={cn(
          "inline-flex cursor-pointer items-center gap-1 rounded-sm px-1.5 py-px",
          "kb-text text-foreground/70",
          hasDisplay ? "bg-primary/8 hover:bg-primary/12" : "bg-warning/10 hover:bg-warning/15",
          "transition-colors duration-100",
        )}
        onClick={() => setOpen(true)}
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
  // Unset and nobody asked: the quiet placeholder every other editor here
  // shows, focusable so the search opens the moment it is aimed at — by click,
  // by Tab, or by anything else that moves focus.
  if (!open && !refId) {
    return (
      <span
        tabIndex={0}
        role="button"
        aria-label="Set reference"
        className={cn(editableClass, "cursor-text italic empty-placeholder text-foreground/25")}
        data-empty-placeholder="true"
        data-ref-slot="closed"
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
      />
    );
  }

  return (
    <div className="relative min-w-0 flex-1">
      <input
        ref={inputRef}
        type="text"
        value={query}
        placeholder="Search node…"
        className={cn(
          editableClass,
          "w-full border-none bg-transparent text-foreground/70 placeholder:text-foreground/25",
        )}
        autoFocus
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setAcIndex(0);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "ArrowDown" && candidates.length > 0) {
            e.preventDefault();
            setAcIndex((i) => (i + 1) % candidates.length);
            return;
          }
          if (e.key === "ArrowUp" && candidates.length > 0) {
            e.preventDefault();
            setAcIndex((i) => (i - 1 + candidates.length) % candidates.length);
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            const pick = candidates[acIndex] ?? candidates[0];
            if (pick) {
              onCommit(pick.id);
              setOpen(false);
              setQuery("");
            } else if (query.trim()) {
              // Manual entry still allowed (filter is suggestions-only).
              onCommit(query.trim());
              setOpen(false);
              setQuery("");
            }
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
            setQuery("");
          }
        }}
        onBlur={() => {
          // Delay so mousedown on suggestion can fire first.
          window.setTimeout(() => {
            setOpen(false);
            setQuery("");
          }, 120);
        }}
      />
      {candidates.length > 0 && (
        <RefAutocomplete
          candidates={candidates}
          activeIndex={acIndex}
          onSelect={(c) => {
            onCommit(c.id);
            setOpen(false);
            setQuery("");
          }}
        />
      )}
      {/* No `.empty-placeholder` sibling — see the note on RefEditor. */}
    </div>
  );
}
