import { useCallback, useEffect, useRef, useState } from "react";
import { LockSimple } from "@phosphor-icons/react";
import { mutations } from "@/actions/mutations";
import { cn } from "@/lib/cn";
import type { OutlineNode } from "@/lib/types";
import { isSysPrefixed } from "@/lib/types";
import { getViewConfig } from "@/lib/view-config";
import { useOutlineStore } from "@/stores/outline.store";
import { FieldsSection } from "./fields-section";
import { TagChipGroup } from "./tag-chip";
import { ViewToolbar } from "./view-toolbar";

/**
 * D13: everything is a node — the zoomed page title edits in place with
 * header typography. sys.* roots stay read-only behind a padlock.
 */
function EditableTitle({ node }: { node: OutlineNode }) {
  const readOnly = isSysPrefixed(node.id);
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const text = node.text;

  useEffect(() => {
    if (!editing || !ref.current) return;
    const el = ref.current;
    el.textContent = text;
    el.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false); // caret at end
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [editing, text]);

  const commit = useCallback(() => {
    if (!ref.current) return;
    const next = ref.current.textContent ?? "";
    setEditing(false);
    if (next !== text) mutations.updateNodeContent(node.id, next);
  }, [node.id, text]);

  const cancel = useCallback(() => {
    if (ref.current) ref.current.textContent = text;
    setEditing(false);
  }, [text]);

  if (readOnly) {
    return (
      <h1
        title={`${text || "Untitled"} (system, read-only)`}
        className={cn(
          TITLE_CLASS,
          "truncate text-foreground/60",
        )}
        data-zoom-title-readonly="true"
      >
        {text || "Untitled"}
      </h1>
    );
  }

  if (editing) {
    return (
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        className={cn(
          TITLE_CLASS,
          "editable rounded-sm outline-none",
          "text-foreground/90 caret-foreground/70",
        )}
        data-zoom-title-editor="true"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        onBlur={commit}
      />
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      title={text || "Untitled"}
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          setEditing(true);
        }
      }}
      className={cn(
        TITLE_CLASS,
        "cursor-text truncate text-foreground/90",
        "rounded-sm transition-colors duration-100 hover:text-foreground",
        !text && 'empty:before:content-["Untitled"]',
      )}
      data-zoom-title="true"
    >
      {text || <br />}
    </div>
  );
}

const TITLE_CLASS = cn(
  "flex min-h-9 min-w-0 flex-1 items-center px-1",
  "text-[20px] font-semibold leading-[1.4]",
);

/** Zoomed root title + tag wash + fields at depth −1 (DESIGN-RESKIN §1.5). */
export function ZoomedRootHeader({ node }: { node: OutlineNode }) {
  const zoomTo = useOutlineStore((s) => s.zoomTo);
  const gradientColor = node.tags[0]?.color ?? null;
  const viewConfig = getViewConfig(node.props);

  return (
    <div
      className="zoomed-root-header px-2 pb-2 pt-1"
      data-zoomed-root-header="true"
      data-frame-id={node.id}
    >
      <div className="relative pl-7 pt-1">
        {gradientColor && (
          <div
            className="pointer-events-none absolute"
            style={{
              top: "-40px",
              left: "-60px",
              right: "-60px",
              bottom: "-30px",
              background: `radial-gradient(ellipse 60% 70% at 50% 35%, ${gradientColor}0c 0%, ${gradientColor}05 40%, transparent 80%)`,
            }}
          />
        )}

        <div className="relative flex min-h-9 items-center justify-between gap-2">
          <EditableTitle node={node} />
          {isSysPrefixed(node.id) && (
            <span
              className="shrink-0 text-foreground/30"
              title="System node — read-only"
              data-sys-lock="true"
            >
              <LockSimple size={14} weight="bold" />
            </span>
          )}
          {/* Tana model: no view chrome on list; compact toolbar only for ≠ list. */}
          {viewConfig.mode !== "list" ? (
            <ViewToolbar frameId={node.id} mode={viewConfig.mode} />
          ) : null}
        </div>

        {node.tags.length > 0 && (
          <div className="relative flex items-center gap-1 pb-2">
            <TagChipGroup
              tags={node.tags}
              onTagClick={(tag, e) => {
                e.stopPropagation();
                zoomTo(tag.id);
              }}
            />
          </div>
        )}
      </div>

      <FieldsSection nodeId={node.id} depth={-1} />
    </div>
  );
}
