// The mode machine. `normal` is the floor of the stack: its keymap runs only
// on keys it binds and lets every other key through. `hint` and `help` sit on
// top of it and own the keyboard while they are up, swallowing every key.
// `disabled` sits on top too and lets everything through: the host pushes it
// when bbim should stand aside (a modal of its own, a game, a recording).
import { Schema } from "effect";

export const Mode = Schema.Literals(["normal", "hint", "help", "disabled"]);
export type Mode = typeof Mode.Type;

export type ModeStack = readonly [Mode, ...Array<Mode>];

export const INITIAL_STACK: ModeStack = ["normal"];

export function current(stack: ModeStack): Mode {
  return stack.at(-1) ?? "normal";
}

/** Enter a mode. Re-entering the current mode is a no-op. */
export function push(stack: ModeStack, mode: Mode): ModeStack {
  return current(stack) === mode ? stack : [...stack, mode];
}

/** Leave `mode` and everything above it; leaving `normal` is impossible. */
export function leave(stack: ModeStack, mode: Mode): ModeStack {
  const index = stack.lastIndexOf(mode);
  if (index <= 0) return stack;
  const [floor, ...rest] = stack.slice(0, index);
  return [floor ?? "normal", ...rest];
}

/** Whether keys go to the mode's own handling and never reach the page. */
export function ownsKeyboard(mode: Mode): boolean {
  return mode === "hint" || mode === "help";
}
