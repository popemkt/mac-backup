import { classifyCardPointer } from "./card-pointer";
import { cardBoxStyle } from "./canvas-card-box";
import {
  asInstance,
  browserHost,
  Bullet,
  cn,
  NodeRow,
  NodeTextHost,
  useIsActive,
  useNode,
} from "@/sdk";
import { useCallback } from "react";
import type { CanvasKbNode, CanvasTextNode } from "@kb/canvas";
import { useNodeTextHostBinding } from "@/stores/node-text-host-binding"; // GAP [[01M41MHRD7MF4NP23EE294B69C]]
import { CanvasPorts } from "./canvas-ports";
import { CanvasResizeHandles, type CanvasCorner } from "./canvas-resize-handles";

/** Stable instance key for a kb-node card on a canvas. */
function canvasCardInstanceKey(cardId: string, nodeId: string): string {
  return `canvas:${cardId}:${nodeId}`;
}

interface KbCardProps {
  card: CanvasKbNode;
  selected: boolean;
  onSelect: () => void;
  onMoveStart: (e: React.PointerEvent) => void;
  onResizeStart: (e: React.PointerEvent, corner: CanvasCorner) => void;
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

/** kb-node card: layout shell + shared NodeRow / NodeTextHost / TagChips. */
export function KbNodeCard({
  card,
  selected,
  onSelect,
  onMoveStart,
  onResizeStart,
  onPortDown,
}: KbCardProps) {
  const node = useNode(card.nodeId);
  const instanceKey = canvasCardInstanceKey(card.id, card.nodeId);
  const isActive = useIsActive(card.nodeId, instanceKey);
  const binding = useNodeTextHostBinding(instanceKey);

  const handleActivate = useCallback(
    (cursorPos?: number) => {
      browserHost().activateNode(card.nodeId, cursorPos, instanceKey);
    },
    [card.nodeId, instanceKey],
  );

  if (!node) {
    return (
      <div
        className="absolute rounded-md border border-destructive/30 bg-background px-2 py-1 text-label text-destructive"
        style={cardBoxStyle(card)}
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
      style={cardBoxStyle(card)}
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
      <CanvasResizeHandles selected={selected} onResizeStart={onResizeStart} />
    </div>
  );
}

interface TextCardProps {
  card: CanvasTextNode;
  selected: boolean;
  onSelect: () => void;
  onChange: (text: string) => void;
  onMoveStart: (e: React.PointerEvent) => void;
  onResizeStart: (e: React.PointerEvent, corner: CanvasCorner) => void;
  onPortDown: (side: "left" | "right" | "top" | "bottom", e: React.PointerEvent) => void;
}

export function TextCard({
  card,
  selected,
  onSelect,
  onChange,
  onMoveStart,
  onResizeStart,
  onPortDown,
}: TextCardProps) {
  return (
    <div
      className={cn(
        "group/card absolute rounded-xl border bg-background p-3 shadow-raised",
        selected ? "border-primary/40" : "border-foreground/12",
      )}
      style={cardBoxStyle(card)}
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
        className="h-full w-full resize-none bg-transparent text-ui outline-none"
        value={card.text}
        onChange={(e) => onChange(e.target.value)}
        onPointerDown={(e) => e.stopPropagation()}
      />
      <CanvasPorts onPortDown={onPortDown} />
      <CanvasResizeHandles selected={selected} onResizeStart={onResizeStart} />
    </div>
  );
}
