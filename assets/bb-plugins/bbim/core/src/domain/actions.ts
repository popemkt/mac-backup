// What bbim can do, and the default key for each. The one home of the action
// list: the keymap, the settings, the help overlay and every host's command
// list derive from it.
import { Schema } from "effect";
import { SCROLL_ACTIONS } from "./scroll.ts";

export const ACTIONS = [
  "hints",
  "hintsNewTab",
  ...SCROLL_ACTIONS,
  "pickScroll",
  "focusInput",
  "help",
] as const;

export const Action = Schema.Literals(ACTIONS);
export type Action = typeof Action.Type;

export interface ActionInfo {
  /** Default key sequence in vim notation; see keys.ts. */
  readonly key: string;
  readonly label: string;
  /** Whether holding the key repeats the action. */
  readonly repeats: boolean;
}

export const ACTION_INFO: Readonly<Record<Action, ActionInfo>> = {
  hints: { key: "f", label: "Show hints: click, follow or focus", repeats: false },
  hintsNewTab: { key: "F", label: "Show hints: open links in a new tab", repeats: false },
  scrollDown: { key: "j", label: "Scroll down", repeats: true },
  scrollUp: { key: "k", label: "Scroll up", repeats: true },
  halfPageDown: { key: "d", label: "Scroll down half a page", repeats: true },
  halfPageUp: { key: "u", label: "Scroll up half a page", repeats: true },
  scrollTop: { key: "gg", label: "Scroll to the top", repeats: false },
  scrollBottom: { key: "G", label: "Scroll to the bottom", repeats: false },
  pickScroll: { key: "gs", label: "Pick the pane j/k/d/u scroll", repeats: false },
  focusInput: { key: "gi", label: "Focus the main text input", repeats: false },
  help: { key: "?", label: "Show this help", repeats: false },
};
