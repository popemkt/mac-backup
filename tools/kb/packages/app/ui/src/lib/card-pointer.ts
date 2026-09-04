import { asElement } from "@/lib/dom";

/**
 * What a pointerdown on a canvas card means.
 *
 * - `chrome` — it landed on a port or a resize handle; that control owns it.
 * - `edit` — it landed in the card's own inner editor; select, do not drag.
 * - `drag` — anywhere else on the card.
 */
export type CardPointerIntent = "chrome" | "edit" | "drag";

/** Ports and resize handles are card chrome on every card kind. */
const CHROME_SELECTOR = "[data-port],[data-resize]";

/**
 * `innerEditor` is the CSS selector for this card kind's editor — the outline
 * row, the textarea, the label input — or `undefined` for a card that has
 * none. It is the only thing that differs between card kinds.
 */
export function classifyCardPointer(
  target: unknown,
  innerEditor: string | undefined,
): CardPointerIntent {
  const el = asElement(target);
  if (el === undefined) return "drag";
  if (el.closest(CHROME_SELECTOR) !== null) return "chrome";
  if (innerEditor !== undefined && el.closest(innerEditor) !== null) return "edit";
  return "drag";
}
