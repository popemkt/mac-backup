import { classifyCardPointer } from "./card-pointer";
import {
  asInstance,
  browserHost,
  canvasInstanceKey,
  Bullet,
  cn,
  NodeRow,
  NodeTextHost,
  useIsActive,
  useNode,
} from "@/sdk";
import { useCallback, useEffect, useEffectEvent, useRef } from "react";
import type { CanvasKbNode, CanvasTextNode } from "@kb/canvas";
import { useNodeTextHostBinding } from "@/stores/node-text-host-binding"; // GAP [[01M41MHRD7MF4NP23EE294B69C]]
import type { FaceLayout } from "./canvas-face";
import { CanvasPorts } from "./canvas-ports";
import { CanvasResizeHandles, type CanvasCorner } from "./canvas-resize-handles";

interface KbCardProps extends FaceLayout {
  card: CanvasKbNode;
  selected: boolean;
  onSelect: () => void;
  onMoveStart: (e: React.PointerEvent) => void;
  onResizeStart: (e: React.PointerEvent, corner: CanvasCorner) => void;
  onRotateStart: (e: React.PointerEvent) => void;
  onPortDown: (side: "left" | "right" | "top" | "bottom", e: React.PointerEvent) => void;
}

/** Canvas text editing excludes structural outline operations. */
function handleCanvasNodeKeyDown(
  event: React.KeyboardEvent<HTMLDivElement>,
  nodeId: string,
  instanceKey: string,
) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    asInstance(event.target, HTMLElement)?.blur();
    browserHost().selectNode(nodeId, instanceKey);
    return;
  }
  if (
    event.key === "Tab" ||
    ((event.key === "Backspace" || event.key === "Delete") && (event.metaKey || event.ctrlKey))
  ) {
    event.preventDefault();
  }
}

/**
 * The editor of a node's text in one instance, kept with the page's edit: an
 * opening activates the node there, its caret at the end of its text, and
 * the node entering or leaving the instance opens or closes it.
 */
function useNodeEdit(
  editing: boolean,
  onEdit: (editing: boolean) => void,
  isActive: boolean,
  activate: () => void,
): void {
  const open = useEffectEvent(() => {
    if (!isActive) activate();
  });
  useEffect(() => {
    if (editing) open();
  }, [editing]);
  const wasActive = useRef(isActive);
  useEffect(() => {
    if (wasActive.current === isActive) return;
    wasActive.current = isActive;
    onEdit(isActive);
  }, [isActive, onEdit]);
}

/** kb-node card: layout shell + shared NodeRow / NodeTextHost / TagChips. */
export function KbNodeCard({
  card,
  projection,
  box,
  editing,
  onEdit,
  selected,
  onSelect,
  onMoveStart,
  onResizeStart,
  onRotateStart,
  onPortDown,
}: KbCardProps) {
  const node = useNode(card.nodeId);
  const instanceKey = canvasInstanceKey(projection, card.id, card.nodeId);
  const isActive = useIsActive(card.nodeId, instanceKey);
  const binding = useNodeTextHostBinding(instanceKey);

  const handleActivate = useCallback(
    (cursorPos?: number) => {
      browserHost().activateNode(card.nodeId, cursorPos, instanceKey);
    },
    [card.nodeId, instanceKey],
  );
  useNodeEdit(editing, onEdit, isActive, () => {
    if (node !== undefined) handleActivate(node.text.length);
  });

  if (!node) {
    return (
      <div
        className="absolute rounded-md border border-destructive/30 bg-background px-2 py-1 text-label text-destructive"
        style={box}
      >
        missing {card.nodeId}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group/card absolute rounded-xl border bg-background shadow-raised",
        selected ? "border-primary/70 ring-2 ring-primary/15" : "border-foreground/12",
      )}
      style={box}
      onPointerDown={(e) => {
        const intent = classifyCardPointer(e.target, ".node-content");
        if (intent === "chrome") return;
        if (intent === "edit") {
          onSelect();
          return;
        }
        e.stopPropagation();
        onSelect();
        onMoveStart(e);
      }}
    >
      <NodeRow
        className="h-full overflow-auto rounded-xl bg-transparent px-3 py-3"
        depth={0}
        nodeId={card.nodeId}
        instanceKey={instanceKey}
        isSelected={selected}
        isActive={isActive}
        onRowClick={() => {
          browserHost().selectNode(card.nodeId, instanceKey);
          onSelect();
        }}
        bullet={
          <Bullet
            node={node}
            isRef
            onClick={(e) => {
              e.stopPropagation();
              browserHost().selectNode(card.nodeId, instanceKey);
            }}
          />
        }
        content={
          <NodeTextHost
            {...binding}
            nodeId={card.nodeId}
            instanceKey={instanceKey}
            content={node.text}
            isActive={isActive}
            tags={node.tags}
            onActivate={handleActivate}
            onChange={(text) => {
              void browserHost().updateNodeContent(card.nodeId, text);
            }}
            onAttachFile={(file) => {
              void browserHost().attachFileToNode(card.nodeId, file);
            }}
            onRemoveTag={(tagId) => {
              void browserHost().removeTag(card.nodeId, tagId);
            }}
            onKeyDown={(event) => handleCanvasNodeKeyDown(event, card.nodeId, instanceKey)}
          />
        }
      />
      <CanvasPorts onPortDown={onPortDown} />
      <CanvasResizeHandles
        selected={selected}
        onResizeStart={onResizeStart}
        onRotateStart={onRotateStart}
      />
    </div>
  );
}

interface TextCardProps extends FaceLayout {
  card: CanvasTextNode;
  selected: boolean;
  onSelect: () => void;
  onChange: (text: string) => void;
  onMoveStart: (e: React.PointerEvent) => void;
  onResizeStart: (e: React.PointerEvent, corner: CanvasCorner) => void;
  onRotateStart: (e: React.PointerEvent) => void;
  onPortDown: (side: "left" | "right" | "top" | "bottom", e: React.PointerEvent) => void;
}

/** A text card: its editor is its textarea, open while it has focus. */
export function TextCard({
  card,
  box,
  editing,
  onEdit,
  selected,
  onSelect,
  onChange,
  onMoveStart,
  onResizeStart,
  onRotateStart,
  onPortDown,
}: TextCardProps) {
  const field = useRef<HTMLTextAreaElement>(null);
  // Opened from the page: the textarea takes focus, its caret after the words.
  useEffect(() => {
    const el = field.current;
    if (!editing || el === null || el.ownerDocument.activeElement === el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);
  return (
    <div
      className={cn(
        "group/card absolute rounded-xl border bg-background p-3 shadow-raised",
        selected ? "border-primary/40" : "border-foreground/12",
      )}
      style={box}
      onPointerDown={(e) => {
        const intent = classifyCardPointer(e.target, "textarea");
        if (intent === "chrome") return;
        if (intent === "edit") {
          onSelect();
          return;
        }
        e.stopPropagation();
        onSelect();
        onMoveStart(e);
      }}
    >
      <textarea
        ref={field}
        className="h-full w-full resize-none bg-transparent text-ui outline-none"
        value={card.text}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => onEdit(true)}
        onBlur={() => onEdit(false)}
        onKeyDown={(e) => {
          // Escape leaves the text, as tldraw's does; what was typed stays.
          if (e.key === "Escape") e.currentTarget.blur();
        }}
        onPointerDown={(e) => e.stopPropagation()}
      />
      <CanvasPorts onPortDown={onPortDown} />
      <CanvasResizeHandles
        selected={selected}
        onResizeStart={onResizeStart}
        onRotateStart={onRotateStart}
      />
    </div>
  );
}
