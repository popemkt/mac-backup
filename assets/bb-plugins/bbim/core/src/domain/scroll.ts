// What the scroll keys do, independent of the DOM. Plain TypeScript with no
// Effect import: the hint bridge carries these actions to a frame
// (protocol.ts), and a frame bundles this file.

/** The scroll actions, in the order the keymap and help list them. */
export const SCROLL_ACTIONS = ["scrollDown", "scrollUp", "halfPageDown", "halfPageUp", "scrollTop", "scrollBottom"] as const;
export type ScrollAction = (typeof SCROLL_ACTIONS)[number];

/** Whether `action` is one of the scroll actions. */
export function isScrollAction(action: string): action is ScrollAction {
  return SCROLL_ACTIONS.some((each) => each === action);
}
