import { usePrefs } from "../hooks";
import { BackdropPoint, chosenBackdrop, useContributions } from "../lib/plugins";
import type { OutlineNode } from "../lib/types";

/**
 * The one page-head slot (DESIGN-UI.md → Page-head backdrops): the chosen
 * backdrop, framed by its presentation, painted behind the head's content.
 * Every page head renders this, with its colour and the node it shows, and
 * names no backdrop; with none contributed it renders nothing.
 */
export function PageBackdrop({ color, node }: { color: string; node?: OutlineNode }) {
  const backdrops = useContributions(BackdropPoint);
  const choice = usePrefs((prefs) => prefs.headerBackdrop);
  const strength = usePrefs((prefs) => prefs.backdropStrength);
  const direction = usePrefs((prefs) => prefs.backdropDirection);
  const chosen = chosenBackdrop(backdrops, choice);
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
        />
      </div>
    </div>
  );
}
