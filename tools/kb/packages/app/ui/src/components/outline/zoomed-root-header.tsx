import { useCallback, useState } from "react";
import { LockSimpleIcon } from "@phosphor-icons/react";
import { mutations } from "@/actions/mutations";
import { cn } from "@/lib/cn";
import type { OutlineNode } from "@/lib/types";
import { isSysPrefixed } from "@/lib/types";
import { nodeTagColors, tagColorAlpha } from "@/lib/tag-color";
import { getViewConfig } from "@/lib/view-config";
import { useOutlineStore } from "@/stores/outline.store";
import { FieldsSection } from "./fields-section";
import { TagChipGroup } from "./tag-chip";
import { ViewToolbar } from "./view-toolbar";
import { NodeContent } from "./node-content";
import { hasText } from "@/lib/text";

/**
 * D13: everything is a node — the zoomed page title edits in place with
 * header typography. sys.* roots stay read-only behind a padlock.
 */
function EditableTitle({ node }: { node: OutlineNode }) {
  const readOnly = isSysPrefixed(node.id);
  const [editing, setEditing] = useState(false);
  const text = node.text;

  const commit = useCallback(() => setEditing(false), []);

  if (readOnly) {
    return (
      <h1
        title={`${text || "Untitled"} (system, read-only)`}
        className={cn(TITLE_CLASS, "truncate text-foreground/60")}
        data-zoom-title-readonly="true"
      >
        {text || "Untitled"}
      </h1>
    );
  }

  if (editing) {
    return (
      <NodeContent
        nodeId={node.id}
        instanceKey={`title/${node.id}`}
        content={text}
        isActive
        tags={[]}
        initialCaret="end"
        textClassName={cn(TITLE_CLASS, "rounded-sm text-foreground/90")}
        onActivate={() => undefined}
        onChange={(next) => {
          if (next !== text) void mutations.updateNodeContent(node.id, next);
        }}
        onBlur={commit}
        zoomTitleEditor
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            commit();
          }
        }}
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
  "text-title font-semibold leading-[1.4]",
);

/**
 * The ambient wash behind a page's head: a soft radial tint of `color`,
 * weakened through the tag-color owner so any CSS colour works. The zoomed
 * header paints its tag's colour; home, which has no tag, paints the accent.
 */
export function HeaderWash({ color }: { color: string }) {
  // The wash spreads 60px past the head on each side, which inside the main
  // region's `overflow-x: auto` is 60px of sideways scroll. So it paints in a
  // box of the head's own width that clips horizontally (`clip`, which, unlike
  // `hidden`, starts no scroll container and leaves the vertical spill alone).
  // Only the wash is clipped, never the editor: a wide table must still scroll.
  return (
    <div
      className="pointer-events-none absolute inset-x-0 overflow-x-clip"
      style={{ top: "-40px", bottom: "-30px" }}
      aria-hidden="true"
      data-header-wash="true"
    >
      <div
        className="absolute inset-y-0"
        style={{
          left: "-60px",
          right: "-60px",
          background:
            `radial-gradient(ellipse 60% 70% at 50% 35%, ` +
            `${tagColorAlpha(color, 4.7)} 0%, ` +
            `${tagColorAlpha(color, 2)} 40%, transparent 80%)`,
        }}
      />
    </div>
  );
}

/** Zoomed root title + tag wash + fields at depth −1 (DESIGN-RESKIN §1.5). */
export function ZoomedRootHeader({ node }: { node: OutlineNode }) {
  const zoomTo = useOutlineStore((s) => s.zoomTo);
  // Ambient wash, not an identity readout: one color is enough, but which
  // color and how it weakens both come from the tag-color owner.
  const washColor = nodeTagColors(node)[0] ?? null;
  const viewConfig = getViewConfig(node.props);

  return (
    <div
      className="zoomed-root-header px-2 pb-2 pt-1"
      data-zoomed-root-header="true"
      data-frame-id={node.id}
    >
      <div className="relative pl-7 pt-1">
        {hasText(washColor) && <HeaderWash color={washColor} />}

        <div className="group/header relative flex min-h-9 items-center justify-between gap-2">
          <EditableTitle node={node} />
          {isSysPrefixed(node.id) && (
            <span
              className="shrink-0 text-foreground/30"
              title="System node — read-only"
              data-sys-lock="true"
            >
              <LockSimpleIcon size={14} weight="bold" />
            </span>
          )}
          {/* A list frame keeps its view control quiet: tucked behind one gear
              that shows on hover or keyboard focus, and stays once opened. A
              projected view shows its toolbar outright. */}
          <span
            className={cn(
              "shrink-0 transition-opacity duration-100",
              viewConfig.mode === "list" &&
                "opacity-0 focus-within:opacity-100 group-hover/header:opacity-100 has-[[data-view-toolbar]]:opacity-100",
            )}
            data-view-control="true"
          >
            <ViewToolbar
              frameId={node.id}
              mode={viewConfig.mode}
              tucked={viewConfig.mode === "list"}
            />
          </span>
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
