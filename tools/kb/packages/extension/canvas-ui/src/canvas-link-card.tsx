import { LinkSimpleIcon } from "@phosphor-icons/react";
import { itemPaint, linkCard, type CanvasLinkNode } from "@kb/canvas";
import { classifyCardPointer } from "./card-pointer";
import type { FaceLayout } from "./canvas-face";
import { ItemOutline } from "./canvas-item-outline";
import { CanvasPorts } from "./canvas-ports";
import { CanvasResizeHandles, type CanvasCorner } from "./canvas-resize-handles";

interface LinkCardProps extends Pick<FaceLayout, "box"> {
  card: CanvasLinkNode;
  selected: boolean;
  onSelect: () => void;
  onMoveStart: (e: React.PointerEvent) => void;
  onResizeStart: (e: React.PointerEvent, corner: CanvasCorner) => void;
  onRotateStart: (e: React.PointerEvent) => void;
  onPortDown: (side: "left" | "right" | "top" | "bottom", e: React.PointerEvent) => void;
}

/**
 * A link item: a card for its web page, its title over its host, both read
 * from the address (`linkCard`); kb never fetches the page. Its chrome is
 * every card's (`ItemOutline`), and following it leads to the page
 * (`itemLead`). It has no editor.
 */
export function LinkCard({
  card,
  box,
  selected,
  onSelect,
  onMoveStart,
  onResizeStart,
  onRotateStart,
  onPortDown,
}: LinkCardProps) {
  const { title, host } = linkCard(card.url);
  return (
    <div
      className="group/card absolute rounded-xl p-3"
      style={box}
      onPointerDown={(e) => {
        if (classifyCardPointer(e.target, undefined) === "chrome") return;
        e.stopPropagation();
        onSelect();
        onMoveStart(e);
      }}
    >
      <ItemOutline item={card} paint={itemPaint(card)} selected={selected} />
      <div data-card-words className="relative flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-ui font-medium text-foreground">{title}</span>
        {host !== "" && (
          <span className="flex min-w-0 items-center gap-1 text-label text-foreground/45">
            <LinkSimpleIcon size={12} className="shrink-0" aria-hidden />
            <span className="truncate">{host}</span>
          </span>
        )}
      </div>
      <CanvasPorts onPortDown={onPortDown} />
      <CanvasResizeHandles
        selected={selected}
        onResizeStart={onResizeStart}
        onRotateStart={onRotateStart}
      />
    </div>
  );
}
