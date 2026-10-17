import { useEffect, useEffectEvent, type RefObject } from "react";
import { asElement, isOutside } from "../lib/dom";

/**
 * What a popover counts as itself, so a press there does not dismiss it: an
 * element (its panel, or the trigger whose own click toggles it), or a
 * selector for the triggers that open it.
 */
export type DismissInside = RefObject<Element | null> | string;

/** How a popover was dismissed: by Escape, or by a press outside it. */
export type DismissHow = "escape" | "press";

/** Whether `target` lies within any of `inside`. */
function within(inside: readonly DismissInside[], target: EventTarget | null): boolean {
  return inside.some((one) =>
    typeof one === "string"
      ? (asElement(target)?.closest(one) ?? null) !== null
      : !isOutside(one.current, target),
  );
}

/**
 * Dismissing a popover (DESIGN-UI.md → Cross-surface polish → Popovers
 * dismiss one way): while `open`, Escape
 * dismisses it and reaches nothing else, and a press anywhere but `inside`
 * dismisses it. Both are heard on the window ahead of everything else
 * (capture), so no handler under the press or the key can keep them from
 * the popover. Every popover, menu and picker that floats over the page
 * dismisses through here.
 */
export function useDismiss(
  open: boolean,
  inside: readonly DismissInside[],
  dismiss: (how: DismissHow) => void,
): void {
  const onDismiss = useEffectEvent(dismiss);
  const pressedOutside = useEffectEvent((target: EventTarget | null) => !within(inside, target));
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      onDismiss("escape");
    };
    const onPress = (e: PointerEvent) => {
      if (pressedOutside(e.target)) onDismiss("press");
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPress, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPress, true);
    };
  }, [open]);
}
