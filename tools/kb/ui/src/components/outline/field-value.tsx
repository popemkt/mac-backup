import type { PropValue } from "@/lib/types";
import type { NodeMap } from "@/lib/types";
import { useCallback, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import {
  emptyValueForType,
  type FieldType,
} from "@/lib/field-type";
import { KB_TEXT_CLASS } from "@/lib/md-inline";
import { fuzzyNodeCandidates } from "@/lib/refs";
import { useOutlineStore } from "@/stores/outline.store";
import { RefAutocomplete } from "@/components/ref-autocomplete";
import { Bullet } from "./bullet";
import { NodeRow } from "./node-row";
import { TagChipGroup } from "./tag-chip";

interface PropValueEditorProps {
  value: PropValue;
  display: string;
  fieldType: FieldType;
  /** When set, ref suggestions are filtered to this id set. */
  allowedRefIds?: Set<string> | null;
  onCommit: (next: PropValue) => void;
  nodes: NodeMap;
}

const editableClass = cn(
  "flex-1 outline-none rounded-sm px-1",
  KB_TEXT_CLASS,
);

const emptyClass = cn(
  "px-1 text-foreground/25 italic",
  KB_TEXT_CLASS,
);

/** Borderless inline prop editors — picked by declared fieldType. */
export function PropValueEditor({
  value,
  display,
  fieldType,
  allowedRefIds = null,
  onCommit,
  nodes,
}: PropValueEditorProps) {
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
          empty={
            value.t !== "num" ||
            value.v === null ||
            value.v === undefined
          }
        />
      );
    case "date":
      return (
        <DateValue
          value={
            value.t === "str" || value.t === "date"
              ? String(value.v)
              : ""
          }
          onChange={(v) => onCommit({ t: "str", v })}
        />
      );
    case "url":
      return (
        <EditableText
          text={value.t === "str" ? String(value.v) : String(value.v ?? "")}
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
          onCommit={(id) => onCommit({ t: "ref", v: id })}
        />
      );
    case "text":
    default:
      return (
        <EditableText
          text={value.t === "str" ? String(value.v ?? "") : String(value.v ?? "")}
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
  allowedRefIds = null,
  onCommit,
  nodes,
}: {
  fieldType: FieldType;
  allowedRefIds?: Set<string> | null;
  onCommit: (next: PropValue) => void;
  nodes: NodeMap;
}) {
  const starter = emptyValueForType(fieldType);
  return (
    <PropValueEditor
      value={starter}
      display=""
      fieldType={fieldType}
      allowedRefIds={allowedRefIds}
      onCommit={onCommit}
      nodes={nodes}
    />
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
      if (e.key === "Enter" && !e.shiftKey) {
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
      data-empty-placeholder={showEmpty ? "true" : undefined}
      suppressContentEditableWarning
    >
      {/* D17: empty state is CSS-only (:empty::before) — the DOM stays
          empty so the caret lands on a truly blank editor. */}
      {showEmpty ? "" : text}
    </div>
  );
}

function BooleanValue({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
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
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);

  const displayDate = value
    ? new Date(String(value)).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  if (editing) {
    return (
      <input
        type="date"
        className={cn(
          editableClass,
          "border-none bg-transparent text-foreground/70",
        )}
        defaultValue={value ? String(value).slice(0, 10) : ""}
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

function RefEditor({
  refId,
  display,
  nodes,
  allowedRefIds,
  onCommit,
}: {
  refId: string;
  display: string;
  nodes: NodeMap;
  allowedRefIds?: Set<string> | null;
  onCommit: (id: string) => void;
}) {
  const zoomTo = useOutlineStore((s) => s.zoomTo);
  const [editing, setEditing] = useState(!refId);
  const [query, setQuery] = useState("");
  const [acIndex, setAcIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const candidates = useMemo(() => {
    const all = fuzzyNodeCandidates(nodes, query);
    if (!allowedRefIds) return all;
    return all.filter((c) => allowedRefIds.has(c.id));
  }, [nodes, query, allowedRefIds]);

  const target = nodes.get(refId);

  if (!editing && target) {
    const primaryColor = target.tags[0]?.color ?? null;
    return (
      <NodeRow
        depth={0}
        nodeId={refId}
        className="cursor-pointer !pl-0"
        onRowClick={() => setEditing(true)}
        bullet={
          <Bullet
            node={{ ...target, collapsed: true }}
            isRef
            tagColor={primaryColor}
            onClick={(e) => {
              e.stopPropagation();
              zoomTo(refId);
            }}
          />
        }
        content={
          <>
            <span
              className={cn(
                KB_TEXT_CLASS,
                "min-w-0 flex-1 truncate text-foreground/70",
              )}
              onClick={(e) => {
                e.stopPropagation();
                setEditing(true);
              }}
            >
              {display || target.text || "\u200B"}
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

  if (!editing && refId && !target) {
    return (
      <span
        className={cn(
          "inline-flex cursor-pointer items-center gap-1 rounded-sm px-1.5 py-px",
          "text-[14.5px] leading-[1.6] bg-primary/8 text-foreground/50",
          "hover:bg-primary/12 transition-colors duration-100",
        )}
        onClick={() => setEditing(true)}
        title={`Node: ${refId}`}
      >
        <span className="h-1 w-1 shrink-0 rounded-full bg-foreground/35" />
        <span className="max-w-[200px] truncate">{refId.slice(0, 12)}</span>
      </span>
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
            setAcIndex(
              (i) => (i - 1 + candidates.length) % candidates.length,
            );
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            const pick = candidates[acIndex] ?? candidates[0];
            if (pick) {
              onCommit(pick.id);
              setEditing(false);
              setQuery("");
            } else if (query.trim()) {
              // Manual entry still allowed (filter is suggestions-only).
              onCommit(query.trim());
              setEditing(false);
              setQuery("");
            }
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
            setQuery("");
          }
        }}
        onBlur={() => {
          // Delay so mousedown on suggestion can fire first.
          window.setTimeout(() => {
            setEditing(Boolean(refId));
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
            setEditing(false);
            setQuery("");
          }}
        />
      )}
      {!refId && candidates.length === 0 && (
        <span
          className={cn(emptyClass, "empty-placeholder")}
          data-empty-placeholder="true"
        />
      )}
    </div>
  );
}
