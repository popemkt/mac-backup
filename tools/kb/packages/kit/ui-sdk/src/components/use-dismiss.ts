import { useInsertionEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { asElement, asInstance, isOutside } from "../lib/dom";

/**
 * What a popover counts as itself, so a press there does not dismiss it: an
 * element, or a selector for the elements.
 */
export type DismissInside = RefObject<Element | null> | string;

/**
 * A popover's parts, as dismissing reads them: what it counts as itself
 * (`inside`: its panel, and anything a press in leaves it open), and its
 * `trigger`, the control whose own click toggles it, or null for a popover
 * nothing toggles (one a command, a key or a gesture opens). The trigger is
 * the popover's own: a press on it dismisses nothing, so its click closes an
 * open popover exactly once rather than the press closing it and the click
 * opening it again.
 */
interface DismissParts {
  readonly inside: readonly DismissInside[];
  readonly trigger: DismissInside | null;
}

/** Whether `target` lies within any of `inside`. */
function within(inside: readonly DismissInside[], target: EventTarget | null): boolean {
  return inside.some((one) =>
    typeof one === "string"
      ? (asElement(target)?.closest(one) ?? null) !== null
      : !isOutside(one.current, target),
  );
}

/**
 * One open popover, as the stack holds it: plain callbacks, which the
 * window's listeners call, reading the popover's latest parts and dismiss
 * from what its last commit left them.
 */
interface Layer {
  readonly holds: (target: EventTarget | null) => boolean;
  readonly dismiss: () => void;
  /** What had focus as it opened, which Escape gives focus back to. */
  readonly opener: Element | null;
}

/** The popovers open now, in the order they opened: the last is on top. */
const layers: Layer[] = [];

/**
 * Escape dismisses the popover on top, reaches nothing else, and gives focus
 * back. Nothing else: no listener below the window, and none on the window
 * after this one, which every popover's opening adds to before.
 */
function onKey(e: KeyboardEvent): void {
  const top = layers.at(-1);
  if (top === undefined || e.key !== "Escape" || e.isComposing) return;
  e.preventDefault();
  e.stopImmediatePropagation();
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
 * every popover above the one it lands in, its `inside` and its `trigger`
 * counting as this one, so a press in a popover opened from another leaves
 * both open and a press on its own trigger leaves the trigger's click to
 * close it. Both are
 * heard on the window ahead of everything else (capture), so no handler
 * under the press or the key can keep them from the popover. Every
 * popover, menu and picker that floats over the page dismisses through here.
 */
export function useDismiss(
  open: boolean,
  { inside, trigger }: DismissParts,
  dismiss: () => void,
): void {
  // What the last commit rendered, for the stack's callbacks to read.
  const latest = useRef({ inside, trigger, dismiss });
  useLayoutEffect(() => {
    latest.current = { inside, trigger, dismiss };
  });
  const opener = useRef<Element | null>(null);
  // Read as it opens, in the commit's mutation phase: before anything it
  // renders takes focus, as an autoFocus input does in the layout phase.
  useInsertionEffect(() => {
    if (open) opener.current = document.activeElement;
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return undefined;
    return openLayer({
      holds: (target) => {
        const parts = latest.current;
        return within(
          parts.trigger === null ? parts.inside : [...parts.inside, parts.trigger],
          target,
        );
      },
      dismiss: () => latest.current.dismiss(),
      opener: opener.current,
    });
  }, [open]);
}
