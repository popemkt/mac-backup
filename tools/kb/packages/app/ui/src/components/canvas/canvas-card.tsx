import { classifyCardPointer } from "@/lib/card-pointer";
import { asInstance } from "@/lib/dom";
import { useCallback } from "react";
import type { CanvasKbNode, CanvasTextNode } from "@kb/canvas";
import { Bullet } from "@/components/outline/bullet";
import { NodeContent } from "@/components/outline/node-content"; // GAP [[01M1RXNGSJT2J2VHDSYY7QJSD3]]
import { NodeRow } from "@/components/outline/node-row";
import { mutations } from "@/actions/mutations";
import { useOutlineStore } from "@/stores/outline.store";
import { cn } from "@/lib/cn";
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
    useOutlineStore.getState().selectNode(nodeId, instanceKey);
    return;
  }
  if (
    event.key === "Tab" ||
    ((event.key === "Backspace" || event.key === "Delete") && (event.metaKey || event.ctrlKey))
  ) {
    event.preventDefault();
  }
}

/** kb-node card: layout shell + shared NodeRow / NodeContent / TagChips. */
export function KbNodeCard({
  card,
  selected,
  onSelect,
  onMoveStart,
  onResizeStart,
  onPortDown,
}: KbCardProps) {
  const node = useOutlineStore((s) => s.nodes.get(card.nodeId));
  const activeNodeId = useOutlineStore((s) => s.activeNodeId);
  const activeInstanceKey = useOutlineStore((s) => s.activeInstanceKey);
  const activateNode = useOutlineStore((s) => s.activateNode);
  const selectNode = useOutlineStore((s) => s.selectNode);
  const instanceKey = canvasCardInstanceKey(card.id, card.nodeId);
  const isActive = activeNodeId === card.nodeId && activeInstanceKey === instanceKey;

  const handleActivate = useCallback(
    (cursorPos?: number) => {
      activateNode(card.nodeId, cursorPos, instanceKey);
    },
    [activateNode, card.nodeId, instanceKey],
  );

  if (!node) {
    return (
      <div
        className="absolute rounded-md border border-destructive/30 bg-background px-2 py-1 text-[11px] text-destructive"
        style={{
          left: card.x,
          top: card.y,
          width: card.width,
          height: card.height,
        }}
      >
        missing {card.nodeId}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group/card absolute rounded-xl border bg-background shadow-sm",
        selected ? "border-primary/70 ring-2 ring-primary/15" : "border-foreground/12",
      )}
      style={{
        left: card.x,
        top: card.y,
        width: card.width,
        height: card.height,
      }}
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
          selectNode(card.nodeId, instanceKey);
          onSelect();
        }}
        bullet={
          <Bullet
            node={node}
            isRef
            onClick={(e) => {
              e.stopPropagation();
              selectNode(card.nodeId, instanceKey);
            }}
          />
        }
        content={
          <NodeContent
            nodeId={card.nodeId}
            instanceKey={instanceKey}
            content={node.text}
            isActive={isActive}
            tags={node.tags}
            onActivate={handleActivate}
            onChange={(text) => {
              void mutations.updateNodeContent(card.nodeId, text);
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
        "group/card absolute rounded-xl border bg-background p-3 shadow-sm",
        selected ? "border-primary/40" : "border-foreground/12",
      )}
      style={{
        left: card.x,
        top: card.y,
        width: card.width,
        height: card.height,
      }}
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
        className="h-full w-full resize-none bg-transparent text-[13px] outline-none"
        value={card.text}
        onChange={(e) => onChange(e.target.value)}
        onPointerDown={(e) => e.stopPropagation()}
      />
      <CanvasPorts onPortDown={onPortDown} />
      <CanvasResizeHandles selected={selected} onResizeStart={onResizeStart} />
    </div>
  );
}
