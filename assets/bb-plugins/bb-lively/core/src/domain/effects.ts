// The effects lively knows, one row each: what a person sees, whether it is
// on by default, and whether it survives "reduced" motion. Everything else
// (settings, the policy, the stylesheet, the docs) reads this table.
import { Schema } from "effect";

export const EFFECT_IDS = [
  "press",
  "hoverLift",
  "listEnter",
  "focusRing",
  "sendPulse",
  "statusPulse",
  "toastSpring",
  "overlayEnter",
  "toggles",
  "typingGlow",
  "calmHost",
] as const;

export const EffectId = Schema.Literals(EFFECT_IDS);
export type EffectId = typeof EffectId.Type;

export interface EffectInfo {
  readonly label: string;
  readonly description: string;
  readonly default: boolean;
  /**
   * Whether the effect stays on under reduced motion. Those that do keep only
   * their opacity part (no travel, no overshoot) at 120 ms or less, so a state
   * change is still visible; the rest switch off.
   */
  readonly reducedSafe: boolean;
}

export const EFFECTS: Readonly<Record<EffectId, EffectInfo>> = {
  press: {
    label: "Press",
    description: "Buttons sink a touch (to 97%) while pressed and spring back on release.",
    default: true,
    reducedSafe: false,
  },
  hoverLift: {
    label: "Hover lift",
    description: "Cards such as notification rows rise 1px under the pointer.",
    default: true,
    reducedSafe: false,
  },
  listEnter: {
    label: "New messages rise in",
    description:
      "A new row at the end of a thread fades in and rises 6px. Rows that scroll into view are never animated; at most 4 animate at once.",
    default: true,
    reducedSafe: true,
  },
  focusRing: {
    label: "Composer focus glow",
    description: "The composer's outline glows softly in the accent color while it has focus.",
    default: true,
    reducedSafe: true,
  },
  sendPulse: {
    label: "Send pulse",
    description: "Sending a message sends a ripple out of the send button; its Send/Stop icon pops as it swaps.",
    default: true,
    reducedSafe: true,
  },
  statusPulse: {
    label: "Thread status pulse",
    description: "A sidebar thread that just finished, failed, or started waiting for you rings twice in its status color.",
    default: true,
    reducedSafe: true,
  },
  toastSpring: {
    label: "Toast spring",
    description: "Notifications slide in on a spring instead of a plain ease.",
    default: true,
    reducedSafe: false,
  },
  overlayEnter: {
    label: "Menus and dialogs",
    description: "Menus, popovers and dialogs open on a quick spring from where they were opened; closing is quicker still.",
    default: true,
    reducedSafe: true,
  },
  toggles: {
    label: "Switches and checkboxes",
    description: "Switch thumbs travel on a spring; a checkbox pops when you tick it.",
    default: true,
    reducedSafe: false,
  },
  typingGlow: {
    label: "Accent caret",
    description: "The composer's caret takes the accent color.",
    default: false,
    reducedSafe: true,
  },
  calmHost: {
    label: "Calm bb's own motion",
    description:
      "Under reduced motion, also stop bb's own menu and dialog open/close animations (bb has no reduced-motion setting of its own). Changes bb's behavior, so off by default.",
    default: false,
    reducedSafe: true,
  },
};

/** `hoverLift` → `hover-lift`: the root attribute suffix (`data-lively-hover-lift`). */
export function effectAttribute(effect: EffectId): string {
  return `data-lively-${effect.replaceAll(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`;
}
