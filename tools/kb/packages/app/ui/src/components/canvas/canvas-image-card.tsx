import { useState } from "react";
import type { CanvasFileNode } from "@kb/canvas";
import { assetSrcUrl, cn } from "@kb/ui-sdk";
import { classifyCardPointer } from "./card-pointer";
import type { FaceLayout } from "./canvas-face";
import { CanvasPorts } from "./canvas-ports";
import { CanvasResizeHandles, type CanvasCorner } from "./canvas-resize-handles";

interface ImageCardProps extends Pick<FaceLayout, "box"> {
  card: CanvasFileNode;
  selected: boolean;
  onSelect: () => void;
  onMoveStart: (e: React.PointerEvent) => void;
  onResizeStart: (e: React.PointerEvent, corner: CanvasCorner) => void;
  onRotateStart: (e: React.PointerEvent) => void;
  onPortDown: (side: "left" | "right" | "top" | "bottom", e: React.PointerEvent) => void;
}

/**
 * An image item: its picture filling its face, served from the asset route
 * as markdown media is (`assetSrcUrl`). It has no editor. An asset that is
 * gone — the assets folder is backup-owned and never committed — shows as
 * missing rather than as a broken picture.
 */
export function ImageCard({
  card,
  box,
  selected,
  onSelect,
  onMoveStart,
  onResizeStart,
  onRotateStart,
  onPortDown,
}: ImageCardProps) {
  const src = assetSrcUrl(card.file);
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <div
      className={cn(
        "group/card absolute rounded-md border bg-background shadow-raised",
        selected ? "border-primary/70 ring-2 ring-primary/15" : "border-foreground/12",
      )}
      style={box}
      onPointerDown={(e) => {
        if (classifyCardPointer(e.target, undefined) === "chrome") return;
        e.stopPropagation();
        onSelect();
        onMoveStart(e);
      }}
    >
      {failed === src ? (
        <div className="flex h-full w-full items-center justify-center px-2 text-label text-foreground/40">
          missing image
        </div>
      ) : (
        <img
          src={src}
          alt=""
          draggable={false}
          className="pointer-events-none h-full w-full rounded-md object-cover"
          onError={() => setFailed(src)}
        />
      )}
      <CanvasPorts onPortDown={onPortDown} />
      <CanvasResizeHandles
        selected={selected}
        onResizeStart={onResizeStart}
        onRotateStart={onRotateStart}
      />
    </div>
  );
}
