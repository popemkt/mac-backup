import type { LensNode } from "@/lib/graph-lens";

/** The card's widest extent: `max-w-72`, plus the room it keeps from the host's edge. */
const CARD_REACH = "18rem + 8px";

/**
 * The hover card every canvas renderer shows beside the pointer: the node's
 * label and its degree. Placed in host-relative CSS pixels and kept inside
 * the host by CSS alone (`100%` is the host's width), never in the way of input.
 */
export function GraphTooltip({
  node,
  x,
  y,
}: {
  readonly node: LensNode;
  readonly x: number;
  readonly y: number;
}) {
  return (
    <div
      className="pointer-events-none absolute z-40 max-w-72 whitespace-normal break-words rounded-md border border-foreground/10 bg-popover px-3 py-2 text-meta leading-4 text-foreground shadow-floating"
      style={{
        left: `max(8px, min(${x + 12}px, 100% - (${CARD_REACH})))`,
        top: Math.max(8, y - 48),
      }}
    >
      {node.label}
      <div className="mt-1 text-foreground/50">{node.degree} connections</div>
    </div>
  );
}
