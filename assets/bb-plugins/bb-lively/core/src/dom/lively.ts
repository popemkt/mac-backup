// createLively: the motion layer in one window. It owns one <style>, the
// root attributes, a reduced-motion listener, the row watcher, the dock
// band's art reach and the one-shot pulses, and removes every one of them
// when its signal aborts.
import { type EffectId, EFFECTS, effectAttribute } from "../domain/effects.ts";
import { MAX_CONCURRENT_ENTERS, type MotionPolicy, resolveMotion, tokensFor } from "../domain/policy.ts";
import type { Preset } from "../domain/presets.ts";
import { decodeSettings } from "../domain/resolve.ts";
import type { SettingsInput, SettingsProblem } from "../domain/settings.ts";
import { ART_IMAGE_PROPERTY } from "./art.ts";
import { detectDrawable, type Drawable } from "./drawable.ts";
import { createPulser } from "./pulser.ts";
import { createReachWatcher } from "./reach.ts";
import { createRefraction, type Refraction } from "./refraction.ts";
import { createRowWatcher } from "./rows.ts";
import { buildStylesheet, CLASSES, PAGE_REPLAYED, PULSE_ATTRIBUTES, ROOT, ROOT_ATTRIBUTES } from "./stylesheet.ts";
import type { Targets } from "./targets.ts";

/** The attribute on lively's own <style>, so it is easy to find and never doubled. */
export const STYLE_ATTRIBUTE = "data-bb-lively";

export type StatusTone = "success" | "error" | "waiting";

export interface CreateLivelyOptions {
  readonly window?: Window;
  readonly signal: AbortSignal;
  readonly targets: Targets;
  readonly settings?: SettingsInput;
  /** The preset table (domain/presets.ts) by default. */
  readonly presets?: ReadonlyArray<Preset>;
  /** The browser's HTML-in-Canvas (dom/drawable.ts); detected from the window by default, `null` for none. */
  readonly drawable?: Drawable | null;
}

export interface Lively {
  /** Replace the settings; returns what was invalid (and fell back to its default). */
  setSettings(input: SettingsInput): ReadonlyArray<SettingsProblem>;
  /** What runs now. */
  policy(): MotionPolicy;
  /** A local send just happened: ripple the send button, and let its echo rise in. */
  sent(): void;
  /** Ring a status row once in a tone (a failure also glitches, under a preset with the glitch); false when it did not run (effect off, paused, already ringing). */
  pulseStatus(row: Element, tone: StatusTone): boolean;
  dispose(): void;
}

/** The event's target as an element, across realms (a frame's element fails `instanceof`). */
function elementOf(target: EventTarget | null): Element | null {
  return target !== null && "closest" in target ? (target as Element) : null;
}

/** Deadline for one pulse: its CSS duration (the policy's tokens, speed applied), plus slack. */
const deadline = (ms: number) => ms + 200;

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

/** How often the waiting scene checks for a request waiting for the person (ms). */
const WAITING_POLL = 800;

export function createLively(options: CreateLivelyOptions): Lively {
  const win = options.window ?? window;
  const doc = win.document;
  const root = doc.documentElement;
  const { targets } = options;
  const presets = options.presets;
  let resolved = decodeSettings(options.settings ?? {}, presets);
  const media = win.matchMedia(REDUCED_QUERY);
  const policyNow = () => resolveMotion(resolved.settings, media.matches, resolved.preset.tokens);
  let current: MotionPolicy = policyNow();
  let disposed = false;

  for (const stale of doc.head.querySelectorAll(`style[${STYLE_ATTRIBUTE}]`)) stale.remove();
  const style = doc.createElement("style");
  style.setAttribute(STYLE_ATTRIBUTE, "");
  style.textContent = buildStylesheet(targets, presets);
  doc.head.append(style);

  const pulser = createPulser(win);
  const enabled = (effect: EffectId) => current.effects.includes(effect);
  /** Another layer is measuring (bbim's hints): start nothing. The stylesheet stops what runs. */
  const suspended = () => targets.suspendOn.some((attribute) => root.hasAttribute(attribute));
  const may = (effect: EffectId) => !disposed && enabled(effect) && !suspended();
  const tokens = () => tokensFor(current);

  const write = () => {
    for (const name of ROOT_ATTRIBUTES) root.removeAttribute(name);
    root.style.removeProperty(ART_IMAGE_PROPERTY);
    if (current.level === "off") return;
    root.setAttribute(ROOT.level, current.level);
    root.setAttribute(ROOT.preset, current.preset);
    if (current.art) root.setAttribute(ROOT.art, "on");
    if (current.artImage !== "") {
      root.setAttribute(ROOT.artImage, "on");
      // ArtImage (domain/settings.ts) admits no quote, backslash or control character.
      root.style.setProperty(ART_IMAGE_PROPERTY, `url("${current.artImage}")`);
    }
    root.setAttribute(ROOT.source, current.source);
    root.setAttribute(ROOT.intensity, current.intensity);
    root.setAttribute(ROOT.style, current.style);
    if (current.skew) root.setAttribute(ROOT.skew, "on");
    if (current.stickers) root.setAttribute(ROOT.stickers, "on");
    if (current.jelly === "matched") root.setAttribute(ROOT.jelly, "matched");
    root.setAttribute(ROOT.speed, current.speed);
    for (const effect of current.effects) root.setAttribute(effectAttribute(effect), "");
    if (canvasLayer() !== undefined) root.setAttribute(ROOT.canvas, "on");
  };

  // The HTML-in-Canvas layer (refraction.ts), for the effects that draw there: made on first
  // need, at the full level only (its scenes are motion), and gone when none of them runs.
  const drawable = options.drawable === undefined ? detectDrawable(win) : (options.drawable ?? undefined);
  let refraction: Refraction | undefined;
  let refractionFailed = false;
  const canvasEffects = () => current.effects.filter((effect) => EFFECTS[effect].canvas !== undefined);
  function canvasLayer(): Refraction | undefined {
    if (drawable === undefined || refractionFailed || disposed || current.level !== "full" || canvasEffects().length === 0) {
      refraction?.dispose();
      refraction = undefined;
      return undefined;
    }
    if (refraction === undefined) {
      refraction = createRefraction({
        win,
        targets,
        drawable,
        // Slower than an entrance (the tokens, speed applied): the architecture shifts, it does not snap.
        duration: (kind) => (kind === "navigate" ? 2.2 : 2.4) * tokens().enterMs,
        chant: () => resolved.preset.lettering?.chant ?? [],
      });
      refractionFailed = refraction === undefined;
    }
    return refraction;
  }
  const refresh = () => {
    current = policyNow();
    write();
  };
  write();
  media.addEventListener("change", refresh);

  // hissResonance on the layer: poll for a request waiting in the open thread (the CSS half needs no script).
  const waitingTimer = win.setInterval(() => {
    if (refraction === undefined) return;
    const present = may("hissResonance") && doc.querySelector(`:is(${targets.pageView}) :is(${targets.pendingRequest})`) !== null;
    refraction.waiting(present);
  }, WAITING_POLL);

  const rows = createRowWatcher({
    win,
    targets,
    onArrive: (arriving) => {
      if (!may("listEnter")) return;
      // At most MAX_CONCURRENT_ENTERS animate; the last of those is marked (wobbly splits it into color).
      const batch = arriving.slice(0, Math.max(0, MAX_CONCURRENT_ENTERS - pulser.running(CLASSES.enter)));
      let stagger = 0;
      for (const [index, row] of batch.entries()) {
        const attributes: Record<string, string> = { [PULSE_ATTRIBUTES.stagger]: String(stagger) };
        if (index === batch.length - 1) attributes[PULSE_ATTRIBUTES.last] = "";
        if (pulser.pulse(row, CLASSES.enter, deadline(tokens().enterMs + 3 * tokens().stagger), attributes)) stagger += 1;
      }
    },
  });

  // The dock band's copy of the backdrop art reaches its thread view's corner (reach.ts).
  const reach = createReachWatcher({ win, targets });

  // press: the sink is pure CSS (:active); the spring back needs to know the press ended.
  const released = (event: PointerEvent) => {
    const target = elementOf(event.target);
    if (!may("press") || target === null) return;
    const pressed = target.closest(targets.pressable);
    if (pressed === null || pressed.closest(targets.pressExclude) !== null) return;
    pulser.pulse(pressed, CLASSES.pressOut, deadline(tokens().releaseMs));
  };
  // toggles: a checkbox pops when it becomes checked.
  const clicked = (event: MouseEvent) => {
    const target = elementOf(event.target);
    if (!may("toggles") || target === null) return;
    const box = target.closest(targets.checkbox);
    if (box === null) return;
    // The host flips its state in its own click handler, after this capture listener.
    win.requestAnimationFrame(() => {
      if (box.getAttribute("aria-checked") === "true" || box.getAttribute("data-state") === "checked") {
        pulser.pulse(box, CLASSES.check, deadline(tokens().releaseMs));
      }
    });
  };
  win.addEventListener("pointerup", released, { capture: true, passive: true });
  win.addEventListener("click", clicked, { capture: true, passive: true });

  // pageEnter, pageWipe: bb keeps the thread window mounted across a thread switch, so
  // the mount animation never runs again; a changed path replays it with a class.
  // The Navigation API reports in-app navigations (bb's router pushes state); popstate covers back.
  // Not every engine has it (happy-dom, older WebKit).
  const navigation: EventTarget | undefined = "navigation" in win ? win.navigation : undefined;
  let path = win.location.pathname;
  const navigated = () => {
    if (win.location.pathname === path) return;
    path = win.location.pathname;
    if (!may("pageEnter") && !may("pageWipe")) return;
    for (const view of doc.querySelectorAll(targets.pageView)) {
      view.setAttribute(PAGE_REPLAYED, "");
      pulser.pulse(view, CLASSES.page, deadline(tokens().enterMs));
    }
  };
  // shiftWarp on the layer: the thread being left is captured before the router renders the next one.
  const leaving = (event: Event) => {
    const destination = (event as Event & { destination?: { url?: string } }).destination?.url;
    if (destination === undefined || !may("shiftWarp")) return;
    if (new URL(destination, win.location.href).pathname === win.location.pathname) return;
    canvasLayer()?.navigate();
  };
  navigation?.addEventListener("currententrychange", navigated);
  navigation?.addEventListener("navigate", leaving);
  win.addEventListener("popstate", navigated);

  const lively: Lively = {
    setSettings: (input) => {
      resolved = decodeSettings(input, presets);
      refresh();
      return resolved.problems;
    },
    policy: () => current,
    sent: () => {
      if (disposed) return;
      rows.armSend();
      if (may("prismEdge")) canvasLayer()?.send();
      if (!may("sendPulse")) return;
      for (const button of doc.querySelectorAll(targets.sendButton)) pulser.pulse(button, CLASSES.send, deadline(tokens().pulseMs));
    },
    // A failure also glitches under a preset that has the glitch, even with the rings off.
    pulseStatus: (row, tone) =>
      (may("statusPulse") || (tone === "error" && may("glitch"))) &&
      pulser.pulse(row, CLASSES.pulse, deadline(2 * tokens().pulseMs), { [PULSE_ATTRIBUTES.tone]: tone }),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      rows.dispose();
      reach.dispose();
      pulser.clear();
      media.removeEventListener("change", refresh);
      win.removeEventListener("pointerup", released, { capture: true });
      win.removeEventListener("click", clicked, { capture: true });
      navigation?.removeEventListener("currententrychange", navigated);
      navigation?.removeEventListener("navigate", leaving);
      win.removeEventListener("popstate", navigated);
      win.clearInterval(waitingTimer);
      refraction?.dispose();
      refraction = undefined;
      for (const view of doc.querySelectorAll(`[${PAGE_REPLAYED}]`)) view.removeAttribute(PAGE_REPLAYED);
      for (const name of ROOT_ATTRIBUTES) root.removeAttribute(name);
      root.style.removeProperty(ART_IMAGE_PROPERTY);
      style.remove();
    },
  };
  if (options.signal.aborted) lively.dispose();
  else options.signal.addEventListener("abort", () => lively.dispose(), { once: true });
  return lively;
}
