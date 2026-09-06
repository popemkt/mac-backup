import type { CSSProperties } from "react";
import type { CanvasDoc, CanvasNode, CanvasSide } from "@kb/canvas";
import { isGroupNode, isKbNode, isShapeNode, isTextNode } from "@kb/canvas";
import { KbNodeCard, TextCard } from "@/components/canvas/canvas-card";
import { ShapeCard } from "@/components/canvas/shape-card";
import type { CanvasSelection } from "@/lib/canvas-selection";
import type { ResizeCorner } from "@/lib/canvas-pointer";
import { classifyCardPointer } from "@/lib/card-pointer";
import { asElement } from "@/lib/dom";
import { hasText } from "@/lib/text";
import { cn } from "@/lib/cn";

interface CanvasCardLayerProps {
  doc: CanvasDoc;
  selection: CanvasSelection;
  onCardSelect: (card: CanvasNode, anchor?: { x: number; y: number }) => void;
  onCardChange: (card: CanvasNode) => void;
  onResizeStart: (cardId: string, corner: ResizeCorner, screen: { x: number; y: number }) => void;
  onPortDown: (cardId: string, side: CanvasSide, screen: { x: number; y: number }) => void;
  onCardPointerDown: (
    card: CanvasNode,
    event: React.PointerEvent,
    anchor?: { x: number; y: number },
  ) => void;
}

type CanvasCardViewProps = Omit<CanvasCardLayerProps, "doc"> & { card: CanvasNode };

function renderPorts(
  card: CanvasNode,
  onPortDown: (side: CanvasSide, event: React.PointerEvent) => void,
) {
  void card;
  return (
    <>
      {(["left", "right", "top", "bottom"] as const).map((side) => (
        <button
          key={side}
          type="button"
          data-port={side}
          aria-label={`Connect ${side}`}
          className={cn(
            "absolute z-10 h-4.5 w-4.5 rounded-full",
            "opacity-0 transition-opacity group-hover/card:opacity-100",
            side === "left" && "top-1/2 left-0 -translate-x-1/2 -translate-y-1/2",
            side === "right" && "top-1/2 right-0 translate-x-1/2 -translate-y-1/2",
            side === "top" && "top-0 left-1/2 -translate-x-1/2 -translate-y-1/2",
            side === "bottom" && "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2",
          )}
          onPointerDown={(event) => {
            event.stopPropagation();
            onPortDown(side, event);
          }}
        >
          <span className="block h-2 w-2 rounded-full border border-foreground/20 bg-background mx-auto mt-[5px]" />
        </button>
      ))}
    </>
  );
}

function CanvasCardView({
  card,
  selection,
  onCardSelect,
  onCardChange,
  onResizeStart,
  onPortDown,
  onCardPointerDown: handleCardPointerDown,
}: CanvasCardViewProps) {
  const renderResizeHandles = (node: CanvasNode, isSelected: boolean) => {
    if (!isSelected) return null;
    const corners: { corner: ResizeCorner; cursor: string; style: CSSProperties }[] = [
      { corner: "nw", cursor: "nwse-resize", style: { top: -4, left: -4 } },
      { corner: "ne", cursor: "nesw-resize", style: { top: -4, right: -4 } },
      { corner: "se", cursor: "nwse-resize", style: { bottom: -4, right: -4 } },
      { corner: "sw", cursor: "nesw-resize", style: { bottom: -4, left: -4 } },
    ];
    return corners.map(({ corner, cursor, style }) => (
      <div
        key={corner}
        data-resize={corner}
        className="absolute z-20 h-2.5 w-2.5 rounded-sm border border-primary/60 bg-background"
        style={{ ...style, cursor }}
        onPointerDown={(event) => {
          event.stopPropagation();
          onResizeStart(node.id, corner, { x: event.clientX, y: event.clientY });
          asElement(event.target)?.setPointerCapture(event.pointerId);
        }}
      />
    ));
  };
  const portHandler = (cardId: string) => (side: CanvasSide, event: React.PointerEvent) => {
    onPortDown(cardId, side, { x: event.clientX, y: event.clientY });
  };

  const isSelected = selection.nodeIds.has(card.id);

  if (isGroupNode(card)) {
    return (
      <div
        key={card.id}
        data-card-id={card.id}
        className={cn(
          "group/card absolute rounded-md border border-dashed bg-foreground/[0.02]",
          isSelected ? "border-primary/40" : "border-foreground/10",
        )}
        style={{
          left: card.x,
          top: card.y,
          width: card.width,
          height: card.height,
        }}
        onPointerDown={(e) => {
          if (classifyCardPointer(e.target, undefined) === "chrome") return;
          e.stopPropagation();
          handleCardPointerDown(card, e);
        }}
      >
        {hasText(card.label) && (
          <div className="px-2 py-1 text-[11px] text-foreground/40">{card.label}</div>
        )}
        {renderResizeHandles(card, isSelected)}
        {renderPorts(card, portHandler(card.id))}
      </div>
    );
  }
  if (isTextNode(card)) {
    return (
      <div key={card.id} data-card-id={card.id}>
        <TextCard
          card={card}
          selected={isSelected}
          onSelect={() => {
            if (!selection.nodeIds.has(card.id)) {
              onCardSelect(card);
            }
          }}
          onChange={(text) => onCardChange({ ...card, text })}
          onMoveStart={(e) => {
            handleCardPointerDown(card, e);
          }}
          onResizeStart={(e) => {
            onResizeStart(card.id, "se", { x: e.clientX, y: e.clientY });
            asElement(e.target)?.setPointerCapture(e.pointerId);
          }}
          onPortDown={portHandler(card.id)}
        />
      </div>
    );
  }
  if (isShapeNode(card)) {
    return (
      <div key={card.id} data-card-id={card.id}>
        <ShapeCard
          card={card}
          selected={isSelected}
          onSelect={(anchor) => {
            if (!selection.nodeIds.has(card.id)) {
              onCardSelect(card, anchor);
            }
          }}
          onLabelChange={(label) => onCardChange({ ...card, label })}
          onMoveStart={(e) => {
            handleCardPointerDown(card, e, {
              x: e.clientX,
              y: e.clientY,
            });
          }}
          onResizeStart={(e) => {
            onResizeStart(card.id, "se", { x: e.clientX, y: e.clientY });
            asElement(e.target)?.setPointerCapture(e.pointerId);
          }}
          onPortDown={portHandler(card.id)}
        />
      </div>
    );
  }
  if (!isKbNode(card)) {
    return (
      <div
        key={card.id}
        data-card-id={card.id}
        className={cn(
          "group/card absolute rounded-md border bg-background px-2 py-1 text-[11px] text-foreground/40",
          isSelected ? "border-primary/40" : "border-foreground/[0.06]",
        )}
        style={{
          left: card.x,
          top: card.y,
          width: card.width,
          height: card.height,
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          handleCardPointerDown(card, e);
        }}
      >
        {card.type}
        {renderResizeHandles(card, isSelected)}
        {renderPorts(card, portHandler(card.id))}
      </div>
    );
  }
  return (
    <div key={card.id} data-card-id={card.id}>
      <KbNodeCard
        card={card}
        selected={isSelected}
        onSelect={() => {
          if (!selection.nodeIds.has(card.id)) {
            onCardSelect(card);
          }
        }}
        onMoveStart={(e) => {
          handleCardPointerDown(card, e);
        }}
        onResizeStart={(e) => {
          onResizeStart(card.id, "se", { x: e.clientX, y: e.clientY });
          asElement(e.target)?.setPointerCapture(e.pointerId);
        }}
        onPortDown={portHandler(card.id)}
      />
    </div>
  );
}

export function CanvasCardLayer(props: CanvasCardLayerProps) {
  return (
    <div data-canvas-stage className="contents">
      {props.doc.nodes.map((card) => (
        <CanvasCardView key={card.id} {...props} card={card} />
      ))}
    </div>
  );
}
