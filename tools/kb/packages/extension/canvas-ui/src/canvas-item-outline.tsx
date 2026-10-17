/**
 * An item's chrome in 2D: its outline (`itemOutline`, as the 3D faces trace
 * it: its shape's, or a line's through its points), filled and stroked as
 * its look says (`itemPaint`), with the marks it wears beyond it
 * (`itemMarks`: a line's heads) — the one way every kind of item draws its ground and its
 * edge in the DOM.
 */
import type { ReactNode } from "react";
import {
  itemMarks,
  svgPathData,
  type CanvasNode,
  toneCss,
  SELECTED_OUTLINE,
  type ItemPaint,
} from "@kb/canvas";
import { outlinePath } from "./canvas-dom-paint";

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
  // A mark is inked as the outline is, drawn or not.
  const markInk = toneCss(selected ? SELECTED_OUTLINE.stroke : chrome.stroke);
  const drawn = selected || outline !== null ? markInk : "none";
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
      {itemMarks(item, item.width, item.height, paint).map((mark, i) => (
        <path
          // oxlint-disable-next-line react/no-array-index-key -- a mark is its place in the list
          key={i}
          data-item-mark
          d={svgPathData(mark.path)}
          fill={mark.filled ? markInk : "none"}
          stroke={markInk}
          strokeWidth={mark.filled ? 0 : Math.max(width, 1)}
        />
      ))}
      {children}
    </svg>
  );
}
