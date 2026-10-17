import { usePageActivity, usePageBackdrop } from "../hooks";
import { usePointerOver } from "../lib/pointer-over";
import type { OutlineNode } from "../lib/types";

/**
 * The one page-head slot (DESIGN-UI.md → Page-head backdrops): the chosen
 * backdrop, framed by its presentation, painted behind the head's content.
 * Every page head renders this, with its colour and the node it shows, and
 * names no backdrop; with none contributed it renders nothing. Which one,
 * how strong and which way are settings (`usePageBackdrop`): the node's own,
 * then core's. The outline's heads render it; canvas and graph pages have
 * no head yet, so nothing renders it there. GAP [[01M54CEKJJXNDPYNT55AR6KEV8]]
 */
export function PageBackdrop({ color, node }: { color: string; node?: OutlineNode }) {
  const { backdrop: chosen, strength, direction } = usePageBackdrop(node);
  const activity = usePageActivity();
  const [pointer, attachFrame] = usePointerOver();
  if (chosen === null) return null;
  const { presentation, Component } = chosen.value;
  const opacity = presentation.opacity[strength];
  return (
    <div
      className="kb-header-backdrop-space relative pointer-events-none"
      style={{ height: `min(${presentation.space}px, 24vw)` }}
      aria-hidden="true"
    >
      <div
        ref={attachFrame}
        className="kb-header-backdrop pointer-events-none"
        data-backdrop={chosen.id}
        data-direction={direction}
        style={{
          position: "absolute",
          left: "50%",
          width: "100%",
          transform: "translateX(-50%)",
          overflow: "hidden",
          height: presentation.height,
          maxWidth: presentation.maxWidth,
          top: presentation.offset,
        }}
        aria-hidden="true"
        data-header-wash="true"
      >
        <Component
          color={color}
          node={node}
          strength={strength}
          direction={direction}
          opacity={opacity}
          activity={activity}
          pointer={pointer}
        />
      </div>
    </div>
  );
}
