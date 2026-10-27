// The send sequence (domain/send.ts): one mechanism for every preset; the
// form's art is the stylesheet's (and the dust's, dust.ts).
//
// The host gives no "about to send" event and clears the composer itself, so:
// - an Enter in the composer, or a press on the send button, copies what the
//   composer shows (a sanitized copy, the text's bounds, and for the dust its
//   glyphs) — cheap, and thrown away if no send follows;
// - when the composer empties within moments of that, the copy is a ghost:
//   lively's own element, held exactly over where the words were, so the
//   words never blink out;
// - the send's echo, the first row of the person's own arriving, is the
//   message landing: the ghost and the message then move along one path, from
//   where the words were to where the message sits, and the ghost goes. With
//   no echo in time (a queued message) the ghost goes on its own;
// - the host swaps its optimistic echo for the stored one at the same index:
//   the motion carries on in the new node, from where it was;
// - the first reply of the turn in the same timeline arrives the same way,
//   from where it is.
// Upstream asks that would replace the guesswork: a `message.appended
// { isLocalSend }` event and `data-row-kind` (docs/research/2026-10-24-bb-theming-feasibility.md §5).
import { type MotionLevel, type MotionTokens, SEND_FORM_INFO, type SendForm } from "../domain/index.ts";
import type { DustSource } from "./dust.ts";
import type { Pulser } from "./pulser.ts";
import type { Refraction } from "./refraction.ts";
import { type Box, glyphsOf, type Glyph, sanitizedCopy, textBounds } from "./snapshot.ts";
import { CLASSES, DRAWN_ATTRIBUTE, GHOST_ATTRIBUTE } from "./stylesheet.ts";
import type { Targets } from "./targets.ts";

/** A copy is a send's only if the composer empties within this long of it (ms). */
const CLEAR_WINDOW_MS = 700;
/** How long a ghost holds for its echo before it goes alone (ms). */
const HOLD_MS = 420;
/** How long after a send its echo may still land along the path, without a ghost (ms). */
const ECHO_WINDOW_MS = 2500;
/** How long after its echo the turn's first reply arrives like the send (ms). */
const REPLY_WINDOW_MS = 180_000;
/** Ghosts on screen at once; an older one goes at once. */
const MAX_GHOSTS = 3;

export interface SendSequenceOptions {
  readonly win: Window;
  readonly targets: Targets;
  readonly pulser: Pulser;
  /** Whether the send's motion may start now (the effect on, nothing measuring). */
  readonly may: () => boolean;
  readonly level: () => MotionLevel;
  readonly form: () => SendForm;
  /** The tokens in force, speed applied. */
  readonly tokens: () => MotionTokens;
  /** The canvas layer, when the form draws there and it can run (full level, WebGL 2). */
  readonly layer: () => Refraction | undefined;
}

export interface SendSequence {
  /** Rows the row watcher reports: claims the send's echo and the turn's first reply, returns the rest. */
  rows(arriving: ReadonlyArray<Element>, rekeyed: ReadonlyArray<Element>): ReadonlyArray<Element>;
  dispose(): void;
}

/** What the composer showed the moment before a send. */
interface Capture {
  readonly at: number;
  readonly box: DOMRect;
  readonly text: Box;
  readonly copy: ReturnType<typeof sanitizedCopy>;
  readonly style: { readonly font: string; readonly color: string; readonly background: string };
  readonly glyphs: ReadonlyArray<Glyph>;
}

/** A send between its composer emptying and its echo landing. */
interface Send {
  readonly capture: Capture;
  readonly at: number;
  ghost: HTMLElement | undefined;
  timer: number | undefined;
  /** It flew (with its echo, or alone): an echo may still land along its path. */
  flown: boolean;
}

/** A message on its way in: kept so the host's swap of its row carries the motion on. */
interface Flight {
  row: Element;
  readonly list: Element | null;
  readonly index: string | null;
  readonly className: string;
  readonly vars: Readonly<Record<string, string>>;
  readonly start: number;
  readonly span: number;
  drawn: boolean;
}

/** A row in one of these is already a containing block for the form's covers and traces. */
const POSITIONED = new Set(["relative", "absolute", "fixed", "sticky"]);

const px = (value: number) => `${Math.round(value * 10) / 10}px`;

/** The path from where the words were to where `bubble` sits, as the message travels it. */
function pathTo(taken: Capture, bubble: Element): readonly [number, number] {
  const to = bubble.getBoundingClientRect();
  return [taken.text.left - to.left, taken.text.top - to.top];
}

export function createSendSequence(options: SendSequenceOptions): SendSequence {
  const { win, targets, pulser } = options;
  const doc = win.document;
  const now = () => win.performance.now();
  let capture: Capture | undefined;
  let watcher: MutationObserver | undefined;
  let watchTimer: number | undefined;
  const sends: Array<Send> = [];
  const flights: Array<Flight> = [];
  /** Where the last echo landed, until its turn's first reply does. */
  let awaiting: { readonly list: Element | null; readonly until: number } | undefined;
  let disposed = false;

  const span = () => options.tokens().enterMs * (options.level() === "full" ? SEND_FORM_INFO[options.form()].span : 1);
  const dustDrawn = () => options.level() === "full" && SEND_FORM_INFO[options.form()].canvas ? options.layer() : undefined;

  // 1. Copy what the composer shows, the moment before a send.
  const take = (form: Element) => {
    if (disposed || !options.may()) return;
    const box = form.querySelector(targets.composerText);
    if (box === null || box.textContent.trim() === "") return;
    const rect = box.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const editor = box.querySelector("[contenteditable]") ?? box;
    const computed = win.getComputedStyle(editor);
    capture = {
      at: now(),
      box: rect,
      text: textBounds(win, editor, rect),
      copy: sanitizedCopy(box),
      style: { font: computed.font, color: computed.color, background: win.getComputedStyle(form).backgroundColor },
      // Only the dust draws glyphs, and only without HTML-in-Canvas.
      glyphs: dustDrawn() !== undefined && dustDrawn()?.copies !== true ? glyphsOf(win, editor, rect) : [],
    };
    watch(form);
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    const target = event.target as Element | null;
    const form = target !== null && "closest" in target ? target.closest(targets.focusBox) : null;
    if (form !== null) take(form);
  };
  const pointerdown = (event: PointerEvent) => {
    const target = event.target as Element | null;
    const form = target !== null && "closest" in target && target.closest(targets.sendButton) !== null ? target.closest(targets.focusBox) : null;
    if (form !== null) take(form);
  };
  const listening = { capture: true, passive: true } as const;
  win.addEventListener("keydown", keydown, listening);
  win.addEventListener("pointerdown", pointerdown, listening);

  // 2. The composer empties: that copy was a send.
  const unwatch = () => {
    watcher?.disconnect();
    watcher = undefined;
    if (watchTimer !== undefined) win.clearTimeout(watchTimer);
    watchTimer = undefined;
  };
  function watch(form: Element): void {
    unwatch();
    const check = () => {
      const box = form.querySelector(targets.composerText);
      if (capture === undefined || (box !== null && box.textContent.trim() !== "")) return;
      const taken = capture;
      capture = undefined;
      unwatch();
      launch(taken);
    };
    watcher = new (win as Window & typeof globalThis).MutationObserver(check);
    watcher.observe(form, { childList: true, subtree: true, characterData: true });
    watchTimer = win.setTimeout(() => {
      capture = undefined;
      unwatch();
    }, CLEAR_WINDOW_MS);
  }

  /** Lively's own copy of the words, over the composer where they were. */
  const ghostOf = (taken: Capture): HTMLElement => {
    const ghost = doc.createElement("div");
    ghost.setAttribute(GHOST_ATTRIBUTE, options.form());
    ghost.setAttribute("aria-hidden", "true");
    ghost.setAttribute("inert", "");
    const { box, style } = taken;
    ghost.style.cssText = `position:fixed;left:${px(box.left)};top:${px(box.top)};width:${px(box.width)};height:${px(box.height)};margin:0;overflow:hidden;pointer-events:none;z-index:2147482000;font:${style.font};color:${style.color}`;
    ghost.style.setProperty("--lively-gh", px(box.height));
    ghost.style.setProperty("--lively-ghost-ground", style.background === "" ? "var(--canvas, Canvas)" : style.background);
    const words = taken.copy.clone;
    words.setAttribute(GHOST_ATTRIBUTE + "-words", "");
    ghost.append(words);
    // Three layers each form may paint (cells, a scan bar, grain); empty under the rest.
    for (const layer of ["1", "2", "3"]) {
      const element = doc.createElement("i");
      element.setAttribute(GHOST_ATTRIBUTE + "-layer", layer);
      ghost.append(element);
    }
    doc.body.append(ghost);
    taken.copy.settle();
    return ghost;
  };

  const launch = (taken: Capture) => {
    if (disposed || !options.may()) return;
    while (sends.filter((send) => send.ghost !== undefined).length >= MAX_GHOSTS) {
      const oldest = sends.find((send) => send.ghost !== undefined);
      if (oldest === undefined) break;
      oldest.ghost?.remove();
      oldest.ghost = undefined;
    }
    const send: Send = { capture: taken, at: now(), ghost: ghostOf(taken), timer: undefined, flown: false };
    sends.push(send);
    // The dust: the words come apart where they are, now; the ghost stands in until the first frame.
    const layer = dustDrawn();
    if (layer !== undefined && send.ghost !== undefined) {
      const ghost = send.ghost;
      const source = dissolve(layer, taken, ghost);
      if (source !== undefined) layer.dust(source);
    }
    send.timer = win.setTimeout(() => fly(send, undefined), HOLD_MS);
  };

  const dissolve = (layer: Refraction, taken: Capture, ghost: HTMLElement): DustSource | undefined => {
    const tokens = options.tokens();
    let copy: HTMLElement | undefined;
    if (layer.copies) {
      copy = doc.createElement("div");
      copy.style.cssText = ghost.style.cssText.replace("position:fixed", "position:absolute");
      copy.append(sanitizedCopy(ghost.firstElementChild ?? ghost).clone);
    } else if (taken.glyphs.length === 0) return undefined;
    // Up and with the wind: a quarter of the way across, a long way up.
    return {
      kind: "dissolve",
      rect: taken.text,
      glyphs: taken.glyphs,
      plates: [],
      ...(copy === undefined ? {} : { copy }),
      wind: [tokens.rise * 9, -tokens.rise * 24],
      duration: span(),
      shift: () => [0, 0],
      shown: () => {
        ghost.setAttribute(DRAWN_ATTRIBUTE, "");
      },
    };
  };

  // 3. The ghost goes: along the path to its echo, or on its own.
  const fly = (send: Send, path: readonly [number, number] | undefined) => {
    if (send.flown) return;
    send.flown = true;
    if (send.timer !== undefined) win.clearTimeout(send.timer);
    const ghost = send.ghost;
    if (ghost === undefined || disposed) return;
    // Alone, it goes up toward the thread, as far as an echo above the composer would be.
    const [dx, dy] = path ?? [0, options.tokens().rise * 6];
    ghost.style.setProperty("--lively-send-dx", px(-dx));
    ghost.style.setProperty("--lively-send-dy", px(-dy));
    // Its end state, so nothing shows once the animation lets go (fills stay backwards-only).
    ghost.style.opacity = "0";
    ghost.classList.add(CLASSES.depart);
    const done = () => {
      ghost.remove();
      if (send.ghost === ghost) send.ghost = undefined;
    };
    ghost.addEventListener("animationend", (event) => {
      if (event.target === ghost) done();
    });
    win.setTimeout(done, span() + 200);
  };

  /** Start a message's arrival on `row` (an echo along `path`, a reply from where it is). */
  const arrive = (row: Element, className: string, path: readonly [number, number], taken: Capture | undefined) => {
    const bubble = row.querySelector(targets.bubble) ?? row;
    const rowBox = row.getBoundingClientRect();
    const bubbleBox = bubble.getBoundingClientRect();
    const vars: Record<string, string> = {
      "--lively-send-dx": px(path[0]),
      "--lively-send-dy": px(path[1]),
      "--lively-bx": px(bubbleBox.left - rowBox.left),
      "--lively-by": px(bubbleBox.top - rowBox.top),
      "--lively-bw": px(bubbleBox.width),
      "--lively-bh": px(bubbleBox.height),
    };
    const length = span();
    const flight: Flight = {
      row,
      list: row.parentElement,
      index: row.getAttribute(targets.rowIndexAttribute),
      className,
      vars,
      start: now(),
      span: length,
      drawn: false,
    };
    // The dust: the message condenses out of dust blown in along the path; the row shows when it settles.
    const layer = dustDrawn();
    let drawn = false;
    if (layer !== undefined) {
      const tokens = options.tokens();
      const copy = layer.copies ? bubbleCopy(bubble, bubbleBox) : undefined;
      const glyphs = layer.copies ? [] : glyphsOf(win, bubble, bubbleBox);
      const source: DustSource = {
        kind: "condense",
        rect: { left: bubbleBox.left, top: bubbleBox.top, width: bubbleBox.width, height: bubbleBox.height },
        glyphs,
        plates: layer.copies ? [] : [plateOf(bubble, bubbleBox)],
        ...(copy === undefined ? {} : { copy }),
        // From the composer's side, and from below: the dust the words became, blowing in.
        wind: taken === undefined ? [-tokens.rise * 3, tokens.rise * 8] : [path[0] * 0.35, Math.max(path[1], tokens.rise * 8)],
        duration: length,
        shift: () => {
          const box = (flight.row.querySelector(targets.bubble) ?? flight.row).getBoundingClientRect();
          return box.width === 0 ? [0, 0] : [box.left - bubbleBox.left, box.top - bubbleBox.top];
        },
        shown: () => undefined,
      };
      drawn = (copy !== undefined || glyphs.length > 0) && layer.dust(source);
    }
    flight.drawn = drawn;
    start(flight, 0);
  };

  const bubbleCopy = (bubble: Element, box: DOMRect): HTMLElement => {
    const copy = doc.createElement("div");
    copy.style.cssText = `position:absolute;left:${px(box.left)};top:${px(box.top)};width:${px(box.width)};height:${px(box.height)};margin:0;overflow:hidden`;
    const { clone, settle } = sanitizedCopy(bubble);
    clone.style.margin = "0";
    copy.append(clone);
    win.queueMicrotask(settle);
    return copy;
  };

  const plateOf = (bubble: Element, box: DOMRect) => {
    // The message's box is often a wrapper; its first painted child is the bubble.
    const painted = [bubble, ...bubble.querySelectorAll("*")].find((element) => {
      const style = win.getComputedStyle(element);
      return style.backgroundColor !== "rgba(0, 0, 0, 0)" && style.backgroundColor !== "transparent";
    });
    const style = painted === undefined ? undefined : win.getComputedStyle(painted);
    const plateBox = painted?.getBoundingClientRect() ?? box;
    return {
      box: { left: plateBox.left, top: plateBox.top, width: plateBox.width, height: plateBox.height },
      radius: Number.parseFloat(style?.borderTopLeftRadius ?? "0") || 0,
      fill: style?.backgroundColor ?? "transparent",
      stroke: style?.borderTopColor ?? "transparent",
    };
  };

  /** Put a flight's class and path on its row, `elapsed` ms in (a swapped row carries on). */
  const start = (flight: Flight, elapsed: number) => {
    const attributes: Record<string, string> = {};
    if (flight.drawn) attributes[DRAWN_ATTRIBUTE] = "";
    if (!pulser.pulse(flight.row, flight.className, Math.max(0, flight.span - elapsed) + 200, attributes)) return;
    const style = (flight.row as HTMLElement).style;
    for (const [name, value] of Object.entries(flight.vars)) style.setProperty(name, value);
    style.setProperty("--lively-send-delay", `${-Math.round(elapsed)}ms`);
    // The form's covers and traces are placed in the row; a host's own positioning (bb's rows are
    // absolute, placed by its virtualizer) is kept, a static row is anchored for the flight only.
    const anchored = !POSITIONED.has(win.getComputedStyle(flight.row).position);
    if (anchored) style.position = "relative";
    const clean = () => {
      for (const name of [...Object.keys(flight.vars), "--lively-send-delay"]) style.removeProperty(name);
      if (anchored) style.removeProperty("position");
    };
    win.setTimeout(clean, Math.max(0, flight.span - elapsed) + 250);
    flights.push(flight);
    win.setTimeout(() => {
      const index = flights.indexOf(flight);
      if (index !== -1) flights.splice(index, 1);
    }, Math.max(0, flight.span - elapsed) + 300);
  };

  return {
    rows: (arriving, rekeyed) => {
      if (disposed) return arriving;
      // The host swapped a landing message's row for another at its place: carry the motion on.
      for (const row of rekeyed) {
        const flight = flights.find((candidate) => !candidate.row.isConnected && candidate.list === row.parentElement && candidate.index === row.getAttribute(targets.rowIndexAttribute));
        if (flight === undefined) continue;
        flights.splice(flights.indexOf(flight), 1);
        const elapsed = now() - flight.start;
        // The dust reads the bubble through the flight, so it follows the new row too.
        flight.row = row;
        if (elapsed < flight.span) start(flight, elapsed);
      }
      if (!options.may()) return arriving;
      const rest: Array<Element> = [];
      for (const row of arriving) {
        const t = now();
        if (row.matches(targets.sentRow)) {
          const send = sends.find((candidate) => t - candidate.at < ECHO_WINDOW_MS);
          if (send !== undefined) {
            sends.splice(sends.indexOf(send), 1);
            const bubble = row.querySelector(targets.bubble) ?? row;
            const path = pathTo(send.capture, bubble);
            fly(send, path);
            arrive(row, CLASSES.arrive, path, send.capture);
            awaiting = { list: row.parentElement, until: t + REPLY_WINDOW_MS };
            continue;
          }
        } else if (awaiting !== undefined && t < awaiting.until && awaiting.list === row.parentElement && row.matches(targets.replyRow)) {
          awaiting = undefined;
          arrive(row, CLASSES.reply, [0, 0], undefined);
          continue;
        }
        rest.push(row);
      }
      // Sends whose echo never came are forgotten.
      for (const send of sends.filter((candidate) => now() - candidate.at >= ECHO_WINDOW_MS)) sends.splice(sends.indexOf(send), 1);
      return rest;
    },
    dispose: () => {
      disposed = true;
      unwatch();
      win.removeEventListener("keydown", keydown, listening);
      win.removeEventListener("pointerdown", pointerdown, listening);
      for (const send of sends) {
        if (send.timer !== undefined) win.clearTimeout(send.timer);
        send.ghost?.remove();
      }
      sends.length = 0;
      flights.length = 0;
      for (const ghost of doc.querySelectorAll(`[${GHOST_ATTRIBUTE}]`)) ghost.remove();
    },
  };
}
