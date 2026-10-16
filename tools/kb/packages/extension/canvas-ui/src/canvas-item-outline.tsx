/**
 * An item's chrome in 2D: its outline traced from the shape table
 * (`shapeOutline`, as the 3D faces trace it), filled and stroked as its
 * look says (`itemPaint`), and its words set as it says — the one way every
 * kind of item draws its ground, its edge and its type in the DOM.
 */
import type { ReactNode } from "react";
import type { CanvasNode } from "@kb/canvas";
import { paintCss } from "./canvas-color";
import { fillCss, outlinePath } from "./canvas-dom-paint";
import type { ItemPaint } from "./canvas-style";

/**
 * The outline, filled and stroked: an uncoloured one in the foreground at
 * `ink` percent; a selected one in the primary over a soft halo. Drawn only;
 * what takes the pointer is the item's own layer. An item that draws no
 * ground of its own draws nothing here.
 */
export function ItemOutline({
  item,
  paint,
  selected,
  ink,
  children,
}: {
  item: CanvasNode;
  paint: ItemPaint;
  selected: boolean;
  ink: number;
  children?: ReactNode;
}) {
  const { chrome } = paint;
  if (chrome === null) return null;
  const d = outlinePath(item);
  const color = paintCss(paint.color);
  const { outline } = chrome;
  const stroke =
    outline === null
      ? "none"
      : (color ?? `color-mix(in oklab, var(--foreground) ${ink}%, transparent)`);
  const width = outline?.width ?? 0;
  return (
    <svg
      data-outline
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      viewBox={`0 0 ${item.width} ${item.height}`}
      aria-hidden
    >
      {selected && (
        <path
          d={d}
          fill="none"
          stroke="color-mix(in oklab, var(--primary) 15%, transparent)"
          strokeWidth={6}
        />
      )}
      <path
        data-outline-path
        d={d}
        fill={fillCss(chrome, color)}
        stroke={selected ? "color-mix(in oklab, var(--primary) 70%, transparent)" : stroke}
        strokeWidth={selected ? Math.max(2, width) : width}
        strokeDasharray={
          outline === null || outline.pattern.length === 0 ? undefined : outline.pattern.join(" ")
        }
      />
      {children}
    </svg>
  );
}
