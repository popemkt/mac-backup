import { useCallback } from "react";
import type { CanvasKbNode, CanvasTextNode } from "@kb/canvas";
import { Bullet } from "@/components/outline/bullet";
import { NodeContent } from "@/components/outline/node-content";
import { NodeRow } from "@/components/outline/node-row";
import { mutations } from "@/actions/mutations";
import { useOutlineStore } from "@/stores/outline.store";
import { cn } from "@/lib/cn";

interface KbCardProps {
  card: CanvasKbNode;
  selected: boolean;
  onSelect: () => void;
  onMoveStart: (e: React.PointerEvent) => void;
  onResizeStart: (e: React.PointerEvent) => void;
  onPortDown: (side: "left" | "right" | "top" | "bottom", e: React.PointerEvent) => void;
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
  const activateNode = useOutlineStore((s) => s.activateNode);
  const selectNode = useOutlineStore((s) => s.selectNode);
  const cursorPosition = useOutlineStore((s) => s.cursorPosition);
  const isActive = activeNodeId === card.nodeId;

  const handleActivate = useCallback(
    (cursorPos?: number) => {
      activateNode(card.nodeId, cursorPos);
    },
    [activateNode, card.nodeId],
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
        "group/card absolute overflow-hidden rounded-md border bg-background",
        selected
          ? "border-primary/40 shadow-sm"
          : "border-foreground/[0.06]",
      )}
      style={{
        left: card.x,
        top: card.y,
        width: card.width,
        height: card.height,
      }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("[data-port]")) return;
        if ((e.target as HTMLElement).closest("[data-resize]")) return;
        if ((e.target as HTMLElement).closest(".node-content")) {
          onSelect();
          return;
        }
        e.stopPropagation();
        onSelect();
        onMoveStart(e);
      }}
    >
      <NodeRow
        depth={0}
        nodeId={card.nodeId}
        isSelected={selected}
        isActive={isActive}
        onRowClick={() => {
          selectNode(card.nodeId);
          onSelect();
        }}
        bullet={
          <Bullet
            node={node}
            tagColor={node.tags[0]?.color ?? null}
            onClick={(e) => {
              e.stopPropagation();
              selectNode(card.nodeId);
            }}
          />
        }
        content={
          <NodeContent
            nodeId={card.nodeId}
            content={node.text}
            isActive={isActive}
            tags={node.tags}
            cursorPosition={cursorPosition}
            onActivate={handleActivate}
            onChange={(text) => mutations.updateNodeContent(card.nodeId, text)}
            onKeyDown={() => {}}
          />
        }
      />
      {(["left", "right", "top", "bottom"] as const).map((side) => (
        <button
          key={side}
          type="button"
          data-port={side}
          aria-label={`Connect ${side}`}
          className={cn(
            "absolute z-10 h-2.5 w-2.5 rounded-full border border-foreground/20 bg-background",
            "opacity-0 transition-opacity group-hover/card:opacity-100",
            side === "left" && "top-1/2 left-0 -translate-x-1/2 -translate-y-1/2",
            side === "right" && "top-1/2 right-0 translate-x-1/2 -translate-y-1/2",
            side === "top" && "top-0 left-1/2 -translate-x-1/2 -translate-y-1/2",
            side === "bottom" &&
              "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2",
          )}
          onPointerDown={(e) => {
            e.stopPropagation();
            onPortDown(side, e);
          }}
        />
      ))}
      <div
        data-resize
        className="absolute right-0 bottom-0 h-3 w-3 cursor-se-resize opacity-0 group-hover/card:opacity-60"
        onPointerDown={(e) => {
          e.stopPropagation();
          onResizeStart(e);
        }}
      />
    </div>
  );
}

interface TextCardProps {
  card: CanvasTextNode;
  selected: boolean;
  onSelect: () => void;
  onChange: (text: string) => void;
  onMoveStart: (e: React.PointerEvent) => void;
  onResizeStart: (e: React.PointerEvent) => void;
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
        "group/card absolute overflow-hidden rounded-md border bg-background p-2",
        selected ? "border-primary/40" : "border-foreground/[0.06]",
      )}
      style={{
        left: card.x,
        top: card.y,
        width: card.width,
        height: card.height,
      }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("[data-port]")) return;
        if ((e.target as HTMLElement).closest("[data-resize]")) return;
        if ((e.target as HTMLElement).tagName === "TEXTAREA") {
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
      {(["left", "right", "top", "bottom"] as const).map((side) => (
        <button
          key={side}
          type="button"
          data-port={side}
          className={cn(
            "absolute z-10 h-2.5 w-2.5 rounded-full border border-foreground/20 bg-background",
            "opacity-0 transition-opacity group-hover/card:opacity-100",
            side === "left" && "top-1/2 left-0 -translate-x-1/2 -translate-y-1/2",
            side === "right" && "top-1/2 right-0 translate-x-1/2 -translate-y-1/2",
            side === "top" && "top-0 left-1/2 -translate-x-1/2 -translate-y-1/2",
            side === "bottom" &&
              "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2",
          )}
          onPointerDown={(e) => {
            e.stopPropagation();
            onPortDown(side, e);
          }}
        />
      ))}
      <div
        data-resize
        className="absolute right-0 bottom-0 h-3 w-3 cursor-se-resize opacity-0 group-hover/card:opacity-60"
        onPointerDown={(e) => {
          e.stopPropagation();
          onResizeStart(e);
        }}
      />
    </div>
  );
}
