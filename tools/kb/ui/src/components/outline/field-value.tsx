import type { PropValue } from "@/lib/types";
import type { NodeMap } from "@/lib/types";
import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { KB_TEXT_CLASS } from "@/lib/md-inline";
import { useOutlineStore } from "@/stores/outline.store";
import { Bullet } from "./bullet";
import { NodeRow } from "./node-row";
import { TagChipGroup } from "./tag-chip";

interface PropValueEditorProps {
  value: PropValue;
  display: string;
  onCommit: (next: PropValue) => void;
  nodes: NodeMap;
}

const editableClass = cn(
  "flex-1 outline-none rounded-sm px-1",
  "text-[14.5px] leading-[1.6]",
);

const emptyClass = cn(
  "px-1 text-[14.5px] leading-[1.6] text-foreground/25 italic",
);

/** Borderless inline prop editors (DESIGN-RESKIN §1.4). */
export function PropValueEditor({
  value,
  display,
  onCommit,
  nodes,
}: PropValueEditorProps) {
  switch (value.t) {
    case "bool":
      return (
        <BooleanValue
          value={value.v}
          onChange={(v) => onCommit({ t: "bool", v })}
        />
      );
    case "num":
      return (
        <EditableText
          text={String(value.v)}
          onCommit={(text) => {
            const n = Number(text.trim());
            if (!Number.isNaN(n)) onCommit({ t: "num", v: n });
          }}
          empty={value.v === null || value.v === undefined}
        />
      );
    case "date":
      return (
        <DateValue
          value={value.v}
          onChange={(v) => onCommit({ t: "date", v })}
        />
      );
    case "ref":
      return (
        <RefValue
          refId={value.v}
          display={display}
          nodes={nodes}
        />
      );
    default:
      return (
        <EditableText
          text={String(value.v ?? "")}
          onCommit={(text) => onCommit({ t: "str", v: text })}
          empty={!value.v}
          underline={false}
        />
      );
  }
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
        showEmpty
          ? "text-foreground/25 italic"
          : underline
            ? "text-primary underline underline-offset-2 decoration-primary/20"
            : "text-foreground/70",
      )}
      onClick={handleClick}
      onBlur={commit}
      onKeyDown={handleKeyDown}
      suppressContentEditableWarning
    >
      {showEmpty ? "Empty" : text}
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
  const inputRef = useRef<HTMLInputElement>(null);

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
        ref={inputRef}
        type="date"
        className={cn(editableClass, "border-none bg-transparent text-foreground/70")}
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
        displayDate ? "text-foreground/70" : "text-foreground/25 italic",
      )}
      onClick={() => setEditing(true)}
    >
      {displayDate ?? "Empty"}
    </span>
  );
}

function RefValue({
  refId,
  display,
  nodes,
}: {
  refId: string;
  display: string;
  nodes: NodeMap;
}) {
  const zoomTo = useOutlineStore((s) => s.zoomTo);
  const target = nodes.get(refId);

  if (!refId) {
    return <span className={emptyClass}>Empty</span>;
  }

  if (!target) {
    return (
      <span
        className={cn(
          "inline-flex cursor-pointer items-center gap-1 rounded-sm px-1.5 py-px",
          "text-[14.5px] leading-[1.6] bg-primary/8 text-foreground/50",
          "hover:bg-primary/12 transition-colors duration-100",
        )}
        onClick={(e) => {
          e.stopPropagation();
          zoomTo(refId);
        }}
        title={`Node: ${refId}`}
      >
        <span className="h-1 w-1 shrink-0 rounded-full bg-foreground/35" />
        <span className="max-w-[200px] truncate">{refId.slice(0, 12)}</span>
      </span>
    );
  }

  const primaryColor = target.tags[0]?.color ?? null;

  return (
    <NodeRow
      depth={0}
      nodeId={refId}
      className="cursor-pointer !pl-0"
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
            className={cn(KB_TEXT_CLASS, "min-w-0 flex-1 truncate text-foreground/70")}
            onClick={(e) => {
              e.stopPropagation();
              zoomTo(refId);
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
