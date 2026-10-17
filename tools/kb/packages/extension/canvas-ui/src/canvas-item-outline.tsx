/**
 * An item's chrome in 2D: its outline (`itemOutline`, as the 3D faces trace
 * it: its shape's, or a line's through its points), filled and stroked as
 * its look says (`itemPaint`), with the heads a line's ends wear
 * (`pathHeads`) — the one way every kind of item draws its ground and its
 * edge in the DOM.
 */
import type { ReactNode } from "react";
import { pathHeads, svgPathData, type CanvasNode } from "@kb/canvas";
import { outlinePath, toneCss } from "./canvas-dom-paint";
import { SELECTED_OUTLINE, type ItemPaint } from "./canvas-style";

/**
 * The outline, filled and stroked in its tones (`itemPaint`); a selected one
 * in the primary over a soft halo. Drawn only; what takes the pointer is the
 * item's own layer. An item that draws no ground of its own draws nothing
 * here.
 */
export function ItemOutline({
  item,
  paint,
  selected,
  children,
}: {
  item: CanvasNode;
  paint: ItemPaint;
  selected: boolean;
  children?: ReactNode;
}) {
  const { chrome } = paint;
  if (chrome === null) return null;
  const d = outlinePath(item);
  const { outline } = chrome;
  const width = outline?.width ?? 0;
  // A head is inked as the line is, drawn or not.
  const headInk = toneCss(selected ? SELECTED_OUTLINE.stroke : chrome.stroke);
  const drawn = selected || outline !== null ? headInk : "none";
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
          stroke={toneCss(SELECTED_OUTLINE.halo)}
          strokeWidth={SELECTED_OUTLINE.haloWidth}
        />
      )}
      <path
        data-outline-path
        d={d}
        fill={chrome.ground === null ? "none" : toneCss(chrome.ground)}
        stroke={drawn}
        strokeWidth={selected ? Math.max(SELECTED_OUTLINE.minWidth, width) : width}
        strokeDasharray={
          outline === null || outline.pattern.length === 0 ? undefined : outline.pattern.join(" ")
        }
      />
      {paint.heads !== null &&
        pathHeads(item, item.width, item.height, paint.heads.length).map(({ end, head }) => (
          <path
            key={end}
            data-item-head={end}
            data-head-kind={head.kind}
            d={svgPathData(head.path)}
            fill={head.filled ? headInk : "none"}
            stroke={headInk}
            strokeWidth={head.filled ? 0 : Math.max(width, 1)}
          />
        ))}
      {children}
    </svg>
  );
}
