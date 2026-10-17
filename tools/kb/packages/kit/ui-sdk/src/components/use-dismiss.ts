import { useEffectEvent, useLayoutEffect, useMemo, type RefObject } from "react";
import { asElement, asInstance, isOutside } from "../lib/dom";

/**
 * What a popover counts as itself, so a press there does not dismiss it: an
 * element (its panel, or the trigger whose own click toggles it), or a
 * selector for the triggers that open it.
 */
export type DismissInside = RefObject<Element | null> | string;

/** Whether `target` lies within any of `inside`. */
function within(inside: readonly DismissInside[], target: EventTarget | null): boolean {
  return inside.some((one) =>
    typeof one === "string"
      ? (asElement(target)?.closest(one) ?? null) !== null
      : !isOutside(one.current, target),
  );
}

/** One open popover, as the stack holds it. */
interface Layer {
  readonly holds: (target: EventTarget | null) => boolean;
  readonly dismiss: () => void;
  /** What had focus as it opened, which Escape gives focus back to. */
  readonly opener: Element | null;
}

/** The popovers open now, in the order they opened: the last is on top. */
const layers: Layer[] = [];

/** Escape dismisses the popover on top, reaches nothing else, and gives focus back. */
function onKey(e: KeyboardEvent): void {
  const top = layers.at(-1);
  if (top === undefined || e.key !== "Escape" || e.isComposing) return;
  e.preventDefault();
  e.stopPropagation();
  top.dismiss();
  if (top.opener?.isConnected === true) asInstance(top.opener, HTMLElement)?.focus();
}

/** A press dismisses every popover above the one it lands in: all of them, when it lands in none. */
function onPress(e: PointerEvent): void {
  const landed = layers.findLastIndex((layer) => layer.holds(e.target));
  for (const layer of layers.slice(landed + 1).toReversed()) layer.dismiss();
}

/** Put `layer` on top, listening while any popover is open; answers how to take it off. */
function openLayer(layer: Layer): () => void {
  if (layers.length === 0) {
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPress, true);
  }
  layers.push(layer);
  return () => {
    layers.splice(layers.indexOf(layer), 1);
    if (layers.length > 0) return;
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("pointerdown", onPress, true);
  };
}

/**
 * Dismissing a popover (DESIGN-UI.md → Cross-surface polish → Popovers
 * dismiss one way). The open popovers are a stack, the last opened on top.
 * While `open`, Escape dismisses the one on top, reaches nothing else, and
 * gives focus back to what had it as that one opened; a press dismisses
 * every popover above the one it lands in, `inside` counting as this one,
 * so a press in a popover opened from another leaves both open. Both are
 * heard on the window ahead of everything else (capture), so no handler
 * under the press or the key can keep them from the popover. Every
 * popover, menu and picker that floats over the page dismisses through here.
 */
export function useDismiss(
  open: boolean,
  inside: readonly DismissInside[],
  dismiss: () => void,
): void {
  const onDismiss = useEffectEvent(dismiss);
  const holds = useEffectEvent((target: EventTarget | null) => within(inside, target));
  // Read as it opens, before anything it renders takes focus.
  const opener = useMemo(
    () => (open && typeof document !== "undefined" ? document.activeElement : null),
    [open],
  );
  useLayoutEffect(() => {
    if (!open) return undefined;
    return openLayer({ holds, dismiss: onDismiss, opener });
  }, [open, opener]);
}
