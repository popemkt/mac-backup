import type { ResizeCorner } from "@/lib/canvas-pointer";
export type CanvasCorner = ResizeCorner;

export function CanvasResizeHandles({
  selected,
  onResizeStart,
}: {
  selected: boolean;
  onResizeStart: (event: React.PointerEvent, corner: CanvasCorner) => void;
}) {
  if (!selected) return null;
  return (["nw", "ne", "se", "sw"] as const).map((corner) => (
    <div
      key={corner}
      data-resize={corner}
      className="absolute z-30 flex h-4 w-4 items-center justify-center"
      style={{
        top: corner.startsWith("n") ? -8 : undefined,
        bottom: corner.startsWith("s") ? -8 : undefined,
        left: corner.endsWith("w") ? -8 : undefined,
        right: corner.endsWith("e") ? -8 : undefined,
        cursor: corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize",
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        onResizeStart(event, corner);
      }}
    >
      <span className="h-2 w-2 rounded-[2px] border border-primary/70 bg-background shadow-sm" />
    </div>
  ));
}
