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
  "pageWipe",
  "workingGlow",
  "typingGlow",
  "turnFreeze",
  "glitch",
  "shiftWarp",
  "hissResonance",
  "calmHost",
] as const;

export const EffectId = Schema.Literals(EFFECT_IDS);
export type EffectId = typeof EffectId.Type;

export interface EffectInfo {
  readonly label: string;
  readonly description: string;
  /** What changes under the wobbly style. */
  readonly wobbly: string;
  readonly default: boolean;
  /**
   * Whether the effect stays on under reduced motion. Those that do keep only
   * their opacity part (no travel, no overshoot, no blur, no loop) at 120 ms
   * or less, so a state change is still visible; the rest switch off.
   */
  readonly reducedSafe: boolean;
  /**
   * A preset's own effect (its signature motion): it runs only while one of
   * these presets (presets.ts) is active, and its switch is on. Absent: every preset.
   */
  readonly presets?: ReadonlyArray<string>;
  /**
   * Drawn on lively's HTML-in-Canvas layer (dom/refraction.ts) when the
   * browser has the API, from the moment that starts it: a thread switch
   * (`navigate`) or a request waiting for the person (`waiting`). (A send's
   * canvas form is the send's own: domain/send.ts.) Its CSS rules are the fallback and stand down while the
   * layer runs (`data-lively-canvas` on the root). Absent: CSS only.
   */
  readonly canvas?: CanvasTrigger;
}

/** What starts an effect's scene on the HTML-in-Canvas layer. */
export const CANVAS_TRIGGERS = ["navigate", "waiting"] as const;
export type CanvasTrigger = (typeof CANVAS_TRIGGERS)[number];

/** Whether an effect belongs to the active preset (every effect without `presets` does). */
export function effectInPreset(info: EffectInfo, preset: string): boolean {
  return info.presets === undefined || info.presets.includes(preset);
}

export const EFFECTS: Readonly<Record<EffectId, EffectInfo>> = {
  press: {
    label: "Press",
    wobbly: "Squashes wide and short while held, and wobbles back like jelly on release.",
    description: "Buttons sink while pressed and spring back on release, with more give and bounce at higher intensity.",
    default: true,
    reducedSafe: false,
  },
  hoverLift: {
    label: "Hover lift",
    wobbly: "Tilts a touch under the pointer; with stickers, a hard offset shadow snaps in and the card nudges up-left.",
    description: "Sidebar thread cards and notification rows rise under the pointer, with a soft shadow at lively and bold.",
    default: true,
    reducedSafe: false,
  },
  listEnter: {
    label: "New messages rise in",
    wobbly: "Arrives from the lower right with a bright flash and a multi-bounce settle, skewing in when skew is on; the last row of a batch splits into color for a frame.",
    description:
      "A new row at the end of a thread fades and rises in, staggered, sharpening from a blur at lively and bold. Rows that scroll into view never animate; at most 4 animate at once.",
    default: true,
    reducedSafe: true,
  },
  focusRing: {
    label: "Composer focus glow",
    wobbly: "A solid accent ring (with a sticker offset when stickers are on) snaps in, then swells once.",
    description: "The composer glows in the accent color while it has focus, breathing slowly at lively and bold.",
    default: true,
    reducedSafe: true,
  },
  sendPulse: {
    label: "Send",
    wobbly: "The default form becomes the slap: the words jump once and cut, the message slaps in with a flash and bounces; the button throws a halftone burst and its icon pops in like a sticker.",
    description:
      "Sending is one motion in the preset's own form: the send button answers, the words you sent leave the composer, and your message lands in the thread along the path from where you wrote it; the agent's first reply arrives the same way. Clean glides, wobbly slaps, and Cloudbank, YoRHa and Control each have their own (cells, a scan, the Hiss's dust).",
    default: true,
    reducedSafe: true,
  },
  statusPulse: {
    label: "Thread status pulse",
    wobbly: "The rings land hard once; the row flashes a chromatic split and swells, and a failed thread shudders.",
    description: "A sidebar thread that just finished, failed, or started waiting for you rings twice in a gradient of its status color.",
    default: true,
    reducedSafe: true,
  },
  toastSpring: {
    label: "Toast spring",
    wobbly: "The slide-in bounces two or three times as it lands (retimed only, never skewed); with stickers, a hard shadow.",
    description: "Notifications slide in and settle on a spring instead of a plain ease.",
    default: true,
    reducedSafe: false,
  },
  overlayEnter: {
    label: "Menus and dialogs",
    wobbly: "Menus spring open from a smaller, tilted start and snap shut; dialogs tilt half as much; with stickers, a hard accent shadow.",
    description:
      "Menus, popovers and dialogs open on a spring from where they were opened, sharpening from a blur at lively and bold; closing is quicker still.",
    default: true,
    reducedSafe: true,
  },
  toggles: {
    label: "Switches and checkboxes",
    wobbly: "Switch thumbs bounce as they land; a ticked checkbox pops in like a sticker with a flash.",
    description: "Switch thumbs travel on a spring; a checkbox pops when you tick it.",
    default: true,
    reducedSafe: false,
  },
  pageEnter: {
    label: "Thread transitions",
    wobbly: "A thread slides in from the lower right and bounces into place (no skew: a whole window skewing is too much).",
    description: "Opening a thread, or a thread in a split pane, fades and rises into place.",
    default: true,
    reducedSafe: true,
  },
  pageWipe: {
    label: "Page wipe",
    wobbly: "The same under either style.",
    description:
      "Switching threads sweeps a slanted, dotted accent panel across the thread (Zenless Zone Zero's screen wipe). It covers the thread for a moment, so off by default.",
    default: false,
    reducedSafe: false,
  },
  workingGlow: {
    label: "Working glow",
    wobbly: "Also breathes in scale, like a character's idle loop.",
    description: "The \"Working…\" line under a running agent breathes with a soft accent glow.",
    default: true,
    reducedSafe: false,
  },
  typingGlow: {
    label: "Accent caret",
    wobbly: "Unchanged.",
    description: "The composer's caret takes the accent color.",
    default: false,
    reducedSafe: true,
  },
  turnFreeze: {
    label: "Turn() freeze",
    wobbly: "The same under either style.",
    description:
      "While the open thread waits for you (an approval, a question, a plan to review), its timeline freezes into a dim, cyan-gridded plan and the request card lights up as a Turn() bar fills along its top, as in Transistor's planning mode. It thaws when you answer. Cloudbank only.",
    default: true,
    // The freeze is a state, not a movement: under reduced motion it shows at once, without the bar filling.
    reducedSafe: true,
    presets: ["cloudbank"],
  },
  glitch: {
    label: "Failure glitch",
    wobbly: "The same under either style.",
    description:
      "A thread that fails tears for a few frames instead of swelling: its sidebar row jumps sideways in hard steps, split into the palette's two signal colors (NieR:Automata's glitch). YoRHa only.",
    default: true,
    reducedSafe: false,
    presets: ["yorha"],
  },
  shiftWarp: {
    label: "Shifting architecture",
    wobbly: "The same under either style.",
    description:
      "Switching threads, the thread you leave breaks into concrete slabs that slide apart with prismatic fringes, as the Oldest House rearranges itself (Control). With HTML-in-Canvas it is the real thread's pixels; without, the new thread assembles from slabs in a chromatic split. Control only.",
    default: true,
    reducedSafe: false,
    presets: ["control"],
    canvas: "navigate",
  },
  hissResonance: {
    label: "Hiss resonance",
    wobbly: "The same under either style.",
    description:
      "While the open thread waits for you (an approval, a question, a plan to review), the Hiss takes it: the timeline dims under a red resonance, the request card burns Hiss red, and an overlapping chant fills the margins. With HTML-in-Canvas the request resonates outward in red echoes; the card itself stays crisp and usable. Control only.",
    default: true,
    // A state: under reduced motion it shows at once and never ripples.
    reducedSafe: true,
    presets: ["control"],
    canvas: "waiting",
  },
  calmHost: {
    label: "Calm bb's own motion",
    wobbly: "Unchanged.",
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
