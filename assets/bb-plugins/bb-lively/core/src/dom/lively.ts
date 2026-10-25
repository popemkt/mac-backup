// createLively: the motion layer in one window. It owns one <style>, the
// root attributes, a reduced-motion listener, the row watcher, the dock
// band's art reach and the one-shot pulses, and removes every one of them
// when its signal aborts.
import { type EffectId, effectAttribute } from "../domain/effects.ts";
import { MAX_CONCURRENT_ENTERS, type MotionPolicy, resolveMotion, tokensFor } from "../domain/policy.ts";
import type { Preset } from "../domain/presets.ts";
import { decodeSettings } from "../domain/resolve.ts";
import type { SettingsInput, SettingsProblem } from "../domain/settings.ts";
import { ART_IMAGE_PROPERTY } from "./art.ts";
import { createPulser } from "./pulser.ts";
import { createReachWatcher } from "./reach.ts";
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
  };
  const refresh = () => {
    current = policyNow();
    write();
  };
  write();
  media.addEventListener("change", refresh);

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
  navigation?.addEventListener("currententrychange", navigated);
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
      win.removeEventListener("popstate", navigated);
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
