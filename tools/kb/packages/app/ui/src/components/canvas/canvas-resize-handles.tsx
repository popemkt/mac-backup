import type { ResizeCorner } from "./canvas-pointer";
export type CanvasCorner = ResizeCorner;

/**
 * A selected card's handles, inside its face so they turn with it: a resize
 * handle at each corner, and tldraw's rotate handle on a stem above the
 * middle of its top edge, which turns the selection about its centre.
 */
export function CanvasResizeHandles({
  selected,
  onResizeStart,
  onRotateStart,
}: {
  selected: boolean;
  onResizeStart: (event: React.PointerEvent, corner: CanvasCorner) => void;
  onRotateStart: (event: React.PointerEvent) => void;
}) {
  if (!selected) return null;
  return (
    <>
      {(["nw", "ne", "se", "sw"] as const).map((corner) => (
        <div
          key={corner}
          data-resize={corner}
          className="pointer-events-auto absolute z-30 flex h-4 w-4 items-center justify-center"
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
          {/* oxlint-disable-next-line design-tokens/no-raw-design-value -- GAP [[01M3AF8G4N9JHJB8YYEWF8F5SZ]] */}
          <span className="h-2 w-2 rounded-[2px] border border-primary/70 bg-background shadow-raised" />
        </div>
      ))}
      <div
        data-rotate
        title="Rotate (⌘ for free angles)"
        className="pointer-events-auto absolute -top-9 left-1/2 z-30 flex h-9 w-6 -translate-x-1/2 cursor-grab flex-col items-center"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          onRotateStart(event);
        }}
      >
        <span className="h-3 w-3 rounded-full border border-primary/70 bg-background shadow-raised" />
        <span className="h-6 w-px bg-primary/50" />
      </div>
    </>
  );
}
