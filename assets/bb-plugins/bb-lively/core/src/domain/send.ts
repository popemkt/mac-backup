// Sending a message, as one motion in three beats, the same mechanism under
// every preset (dom/send.ts):
// - the send button answers;
// - the words you sent leave the composer: a ghost of them, held exactly where
//   they were, goes the moment bb clears the composer;
// - your message lands in the thread along the path from where you wrote it,
//   and the agent's first reply of the turn arrives the same way, from where
//   it already is.
// A preset picks the form those beats take, its art; the forms are a closed
// set, so a new preset reuses one or adds one here. How far and how fast is
// the intensity's tokens (motion.ts `travel`, `enterMs`), never the form's.
import { Schema } from "effect";
import type { Style } from "./motion.ts";

export const SEND_FORMS = ["glide", "slap", "process", "scan", "dust"] as const;
export const SendForm = Schema.Literals(SEND_FORMS);
export type SendForm = typeof SendForm.Type;

export interface SendFormInfo {
  readonly label: string;
  readonly description: string;
  /** How long the beats run, as a multiple of the entrance (`enterMs`, speed applied). */
  readonly span: number;
  /**
   * Drawn as particles on lively's canvas layer (dom/dust.ts) when the
   * browser has WebGL 2, from the real pixels with HTML-in-Canvas; its CSS
   * rules are the fallback.
   */
  readonly canvas: boolean;
}

export const SEND_FORM_INFO: Readonly<Record<SendForm, SendFormInfo>> = {
  glide: {
    label: "Glide",
    description: "The words glide from the composer to where the message lands, and the message comes in along the same path, sharpening as it settles.",
    span: 1.1,
    canvas: false,
  },
  slap: {
    label: "Slap",
    description: "The words jump once toward the thread and cut; the message slaps in along the path with a flash, a sticker shadow and a bounce.",
    span: 1,
    canvas: false,
  },
  process: {
    label: "Process",
    description: "The words whitewash into blank cells and the message assembles out of them along a turquoise trace, in steps.",
    span: 1.6,
    canvas: false,
  },
  scan: {
    label: "Scan",
    description: "A scan bar erases the words line by line; the message prints in under a scan bar, a marker blinking at its corner.",
    span: 1.6,
    canvas: false,
  },
  dust: {
    label: "Dust",
    description:
      "The words come apart into soft, dark, prismatic dust that drifts up like dust in the wind, and the message condenses out of it.",
    span: 3,
    canvas: true,
  },
};

/** The form for a preset that names none: the style's own. */
export function defaultSendForm(style: Style): SendForm {
  return style === "wobbly" ? "slap" : "glide";
}
