// The effects lively knows, one row each: what a person sees, whether it is
// on by default, and whether it survives "reduced" motion. Everything else
// (settings, the policy, the stylesheet, the docs) reads this table. How far
// and how springy each effect moves is not here: that is the intensity's
// tokens (motion.ts), shared by every effect.
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
  "pageEnter",
  "workingGlow",
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
   * their opacity part (no travel, no overshoot, no blur, no loop) at 120 ms
   * or less, so a state change is still visible; the rest switch off.
   */
  readonly reducedSafe: boolean;
}

export const EFFECTS: Readonly<Record<EffectId, EffectInfo>> = {
  press: {
    label: "Press",
    description: "Buttons sink while pressed and spring back on release, with more give and bounce at higher intensity.",
    default: true,
    reducedSafe: false,
  },
  hoverLift: {
    label: "Hover lift",
    description: "Sidebar thread cards and notification rows rise under the pointer, with a soft shadow at lively and bold.",
    default: true,
    reducedSafe: false,
  },
  listEnter: {
    label: "New messages rise in",
    description:
      "A new row at the end of a thread fades and rises in, staggered, sharpening from a blur at lively and bold. Rows that scroll into view never animate; at most 4 animate at once.",
    default: true,
    reducedSafe: true,
  },
  focusRing: {
    label: "Composer focus glow",
    description: "The composer glows in the accent color while it has focus, breathing slowly at lively and bold.",
    default: true,
    reducedSafe: true,
  },
  sendPulse: {
    label: "Send burst",
    description:
      "Sending ripples out of the send button, with a burst of accent sparks at lively and bold; the Send/Stop icon pops as it swaps.",
    default: true,
    reducedSafe: true,
  },
  statusPulse: {
    label: "Thread status pulse",
    description: "A sidebar thread that just finished, failed, or started waiting for you rings twice in a gradient of its status color.",
    default: true,
    reducedSafe: true,
  },
  toastSpring: {
    label: "Toast spring",
    description: "Notifications slide in and settle on a spring instead of a plain ease.",
    default: true,
    reducedSafe: false,
  },
  overlayEnter: {
    label: "Menus and dialogs",
    description:
      "Menus, popovers and dialogs open on a spring from where they were opened, sharpening from a blur at lively and bold; closing is quicker still.",
    default: true,
    reducedSafe: true,
  },
  toggles: {
    label: "Switches and checkboxes",
    description: "Switch thumbs travel on a spring; a checkbox pops when you tick it.",
    default: true,
    reducedSafe: false,
  },
  pageEnter: {
    label: "Thread transitions",
    description: "Opening a thread, or a thread in a split pane, fades and rises into place.",
    default: true,
    reducedSafe: true,
  },
  workingGlow: {
    label: "Working glow",
    description: "The \"Working…\" line under a running agent breathes with a soft accent glow.",
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
