import { useCallback, useState } from "react";
import { LockSimpleIcon } from "@phosphor-icons/react";
import {
  cn,
  hasText,
  isSysPrefixed,
  nodeTagColors,
  rowText,
  rowTextReadOnlyReason,
  schemaOf,
  TagChipGroup,
  type OutlineNode,
} from "@kb/ui-sdk";
import { projectsRows, type FrameViewKey } from "@kb/views";
import { useOutlineStore } from "@/stores/outline.store";
import { useOpenNode } from "@/stores/follow";
import { FieldsSection } from "./fields-section";
import { ViewToolbar } from "./view-toolbar";
import { NodeContent } from "./node-content";
import { HeaderBackdrop } from "./header-backdrop";

/**
 * D13: everything is a node — the zoomed page title edits in place with
 * header typography. sys.* roots stay read-only behind a padlock.
 */
function EditableTitle({ node }: { node: OutlineNode }) {
  const schema = useOutlineStore(schemaOf);
  // The same text channel as a row: what it shows and whether it can be
  // written are the row rules (`lib/contextual-ref`), not a second copy.
  const readOnly = rowTextReadOnlyReason(node.id, node, schema) !== null;
  const [editing, setEditing] = useState(false);
  const text = rowText(node, schema);

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
        node={node}
        instanceKey={`title/${node.id}`}
        isActive
        tags={[]}
        initialCaret="end"
        textClassName={cn(TITLE_CLASS, "rounded-sm text-foreground/90")}
        onActivate={() => undefined}
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

/** Zoomed root title + tag wash + fields at depth −1 (DESIGN-RESKIN §1.5). */
export function ZoomedRootHeader({
  node,
  view,
}: {
  readonly node: OutlineNode;
  /** The view the node shows its children in, as its host resolved it (`frameViewOf`). */
  readonly view: FrameViewKey | null;
}) {
  const zoomTo = useOpenNode();
  // Ambient wash, not an identity readout: one color is enough, but which
  // color and how it weakens both come from the tag-color owner.
  const washColor = nodeTagColors(node)[0] ?? null;
  const isList = !projectsRows(view);

  return (
    <div
      className="zoomed-root-header px-2 pb-2 pt-1"
      data-zoomed-root-header="true"
      data-frame-id={node.id}
    >
      <div className="relative pl-7 pt-1">
        {hasText(washColor) && <HeaderBackdrop color={washColor} />}

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
              isList &&
                "opacity-0 focus-within:opacity-100 group-hover/header:opacity-100 has-[[data-view-toolbar]]:opacity-100",
            )}
            data-view-control="true"
          >
            <ViewToolbar frameId={node.id} view={view} tucked={isList} />
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

      <FieldsSection nodeId={node.id} depth={-1} instanceKey={`title/${node.id}`} />
    </div>
  );
}
