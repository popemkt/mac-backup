import type { LensNode } from "@/lib/graph-lens";

/**
 * The hover card every canvas renderer shows beside the pointer: the node's
 * label and its degree. Placed in host-relative CSS pixels, kept inside the
 * host's width, and never in the way of input.
 */
export function GraphTooltip({
  node,
  x,
  y,
  hostWidth,
}: {
  readonly node: LensNode;
  readonly x: number;
  readonly y: number;
  readonly hostWidth: number;
}) {
  return (
    <div
      className="pointer-events-none absolute z-40 max-w-72 whitespace-normal break-words rounded-md border border-foreground/10 bg-popover px-3 py-2 text-meta leading-4 text-foreground shadow-floating"
      style={{
        left: Math.max(8, Math.min(x + 12, hostWidth - 280)),
        top: Math.max(8, y - 48),
      }}
    >
      {node.label}
      <div className="mt-1 text-foreground/50">{node.degree} connections</div>
    </div>
  );
}
