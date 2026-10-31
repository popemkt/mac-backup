// createLively over a happy-dom page: root attributes, cleanup, the
// reduced-motion listener, list arrivals, pulses and the suspend attribute.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { effectAttribute } from "../src/domain/index.ts";
import { createLively, type Lively, STYLE_ATTRIBUTE } from "../src/dom/lively.ts";
import { createReachWatcher, REACH } from "../src/dom/reach.ts";
import { CLASSES, PAGE_REPLAYED, ROOT, ROOT_ATTRIBUTES } from "../src/dom/stylesheet.ts";
import { page, type Page, rowHtml, TARGETS } from "./harness.ts";

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const step of cleanup) step();
  cleanup = [];
});

function mounted(html = "", settings = {}): { p: Page; lively: Lively; controller: AbortController } {
  const p = page(html);
  const controller = new AbortController();
  const lively = createLively({ window: p.win, signal: controller.signal, targets: TARGETS, settings });
  cleanup.push(() => {
    controller.abort();
    p.close();
  });
  return { p, lively, controller };
}

const TIMELINE = `<div class="timeline">${rowHtml("a", 0)}${rowHtml("b", 1)}${rowHtml("c", 2)}</div>`;

function append(p: Page, id: string, index: number): Element {
  const list = p.doc.querySelector(".timeline");
  list?.insertAdjacentHTML("beforeend", rowHtml(id, index));
  return list?.lastElementChild as Element;
}

const entering = (p: Page) => [...p.doc.querySelectorAll(`.${CLASSES.enter}`)].map((row) => row.getAttribute("data-id"));

test("mount: one stylesheet and the root attributes of the default policy", () => {
  const { p } = mounted();
  assert.equal(p.doc.querySelectorAll(`style[${STYLE_ATTRIBUTE}]`).length, 1);
  assert.equal(p.root.getAttribute("data-lively"), "full");
  assert.equal(p.root.getAttribute("data-lively-source"), "system");
  assert.equal(p.root.getAttribute("data-lively-speed"), "normal");
  assert.equal(p.root.getAttribute("data-lively-intensity"), "bold");
  assert.equal(p.root.getAttribute("data-lively-style"), "clean");
  assert.ok(p.root.hasAttribute(effectAttribute("press")));
  assert.ok(!p.root.hasAttribute(effectAttribute("typingGlow")), "off by default");
});

test("abort removes the stylesheet, every root attribute and every running class", () => {
  const { p, lively, controller } = mounted(`<div class="thread"></div>`);
  lively.pulseStatus(p.doc.querySelector(".thread") as Element, "success");
  controller.abort();
  assert.equal(p.doc.querySelectorAll(`style[${STYLE_ATTRIBUTE}]`).length, 0);
  for (const name of ROOT_ATTRIBUTES) assert.ok(!p.root.hasAttribute(name), name);
  assert.equal(p.doc.querySelectorAll(`.${CLASSES.pulse}, [data-lively-tone]`).length, 0);
});

test("settings: off clears every motion attribute, the art staying; an effect switched off loses its attribute; speed is written", () => {
  const { p, lively } = mounted();
  lively.setSettings({ motion: "off" });
  const art = new Set<string>([ROOT.preset, ROOT.art]);
  for (const name of ROOT_ATTRIBUTES.filter((attribute) => !art.has(attribute))) assert.ok(!p.root.hasAttribute(name), name);
  assert.equal(p.root.getAttribute(ROOT.art), "on", "art is paint: the preset's art holds with motion off");
  lively.setSettings({ motion: "off", art: false });
  assert.ok(!p.root.hasAttribute(ROOT.art));
  lively.setSettings({ speed: "snappy", intensity: "subtle", effects: { press: false } });
  assert.equal(p.root.getAttribute("data-lively-intensity"), "subtle");
  assert.equal(p.root.getAttribute("data-lively-speed"), "snappy");
  assert.ok(!p.root.hasAttribute(effectAttribute("press")));
  assert.ok(p.root.hasAttribute(effectAttribute("hoverLift")));
});

test("style: wobbly writes its style, skew, stickers and jelly; clean writes none of the extras", () => {
  const { p, lively } = mounted();
  assert.ok(!p.root.hasAttribute("data-lively-skew") && !p.root.hasAttribute("data-lively-stickers") && !p.root.hasAttribute("data-lively-jelly"));
  lively.setSettings({ motion: "full", style: "wobbly", jelly: "matched", effects: { pageWipe: true } });
  assert.equal(p.root.getAttribute("data-lively-style"), "wobbly");
  assert.equal(p.root.getAttribute("data-lively-skew"), "on");
  assert.equal(p.root.getAttribute("data-lively-stickers"), "on");
  assert.equal(p.root.getAttribute("data-lively-jelly"), "matched");
  assert.ok(p.root.hasAttribute(effectAttribute("pageWipe")));
  lively.setSettings({ motion: "reduced", style: "wobbly" });
  assert.ok(!p.root.hasAttribute("data-lively-skew"), "no skew under reduced motion");
  assert.equal(p.root.getAttribute("data-lively-stickers"), "on", "stickers are paint, not motion");
  assert.ok(!p.root.hasAttribute(effectAttribute("pageWipe")), "the wipe is off under reduced motion");
  lively.setSettings({ motion: "full", style: "clean", stickers: "always" });
  assert.equal(p.root.getAttribute("data-lively-stickers"), "on");
  assert.ok(!p.root.hasAttribute("data-lively-skew"));
});

test("a thread switch replays the page entrance on the window that stayed mounted", () => {
  const { p, lively, controller } = mounted(`<div class="page"></div>`);
  const view = p.doc.querySelector(".page") as Element;
  const navigate = (to: string) => {
    p.win.history.pushState({}, "", to);
    p.win.dispatchEvent(new p.win.PopStateEvent("popstate"));
  };
  p.win.dispatchEvent(new p.win.PopStateEvent("popstate"));
  assert.ok(!view.classList.contains(CLASSES.page), "the same path is no switch");
  navigate("/threads/other");
  assert.ok(view.classList.contains(CLASSES.page));
  assert.ok(view.hasAttribute(PAGE_REPLAYED), "the mount rule stops matching for good");
  lively.setSettings({ effects: { pageEnter: false } });
  view.classList.remove(CLASSES.page);
  navigate("/threads/third");
  assert.ok(!view.classList.contains(CLASSES.page), "nothing replays with both page effects off");
  controller.abort();
  assert.ok(!view.hasAttribute(PAGE_REPLAYED));
});

test("system mode follows a live change of the OS preference", () => {
  const { p, lively } = mounted();
  p.setReducedMotion(true);
  assert.equal(p.root.getAttribute("data-lively"), "reduced");
  assert.ok(!p.root.hasAttribute(effectAttribute("press")), "press has no reduced form");
  assert.ok(p.root.hasAttribute(effectAttribute("listEnter")));
  assert.equal(lively.policy().level, "reduced");
  p.setReducedMotion(false);
  assert.equal(p.root.getAttribute("data-lively"), "full");
});

test("listEnter: a row arriving at the end rises in; the rows already there never do", async () => {
  const { p } = mounted(TIMELINE);
  append(p, "d", 3);
  await p.settle();
  assert.deepEqual(entering(p), ["d"]);
});

test("listEnter: a row that scrolls back into view (an old index) does not animate", async () => {
  const { p } = mounted(TIMELINE);
  p.doc.querySelector('[data-id="a"]')?.remove();
  await p.settle();
  const list = p.doc.querySelector(".timeline");
  list?.insertAdjacentHTML("afterbegin", rowHtml("older", -1));
  await p.settle();
  assert.deepEqual(entering(p), []);
});

test("listEnter: a remounted row (seen id) never animates twice", async () => {
  const { p } = mounted(TIMELINE);
  const row = p.doc.querySelector('[data-id="c"]');
  row?.remove();
  await p.settle();
  append(p, "c", 2);
  await p.settle();
  assert.deepEqual(entering(p), []);
});

test("listEnter: a swapped list (another thread) is taken as already there", async () => {
  const { p } = mounted(TIMELINE);
  const list = p.doc.querySelector(".timeline") as Element;
  list.innerHTML = rowHtml("x", 7) + rowHtml("y", 8);
  await p.settle();
  assert.deepEqual(entering(p), []);
  append(p, "z", 9);
  await p.settle();
  assert.deepEqual(entering(p), ["z"], "arrivals in the new thread rise in again");
});

test("listEnter: at most 4 rows animate at once, staggered; more than 4 at once is a jump", async () => {
  const { p } = mounted(TIMELINE);
  const list = p.doc.querySelector(".timeline") as Element;
  list.insertAdjacentHTML("beforeend", [3, 4, 5].map((index) => rowHtml(`n${index}`, index)).join(""));
  await p.settle();
  assert.deepEqual(entering(p), ["n3", "n4", "n5"]);
  assert.deepEqual(
    [...p.doc.querySelectorAll(`.${CLASSES.enter}`)].map((row) => row.getAttribute("data-lively-stagger")),
    ["0", "1", "2"],
  );
  assert.deepEqual(
    [...p.doc.querySelectorAll("[data-lively-last]")].map((row) => row.getAttribute("data-id")),
    ["n5"],
    "the last row of the batch is marked",
  );
  append(p, "n6", 6);
  append(p, "n7", 7);
  await p.settle();
  assert.equal(entering(p).length, 4, "the fifth appears at rest");
  list.insertAdjacentHTML("beforeend", [8, 9, 10, 11, 12].map((index) => rowHtml(`j${index}`, index)).join(""));
  await p.settle();
  assert.ok(!entering(p).some((id) => id?.startsWith("j")), "five at once is a jump");
});

test("listEnter: nothing rises while the person is scrolling, unless they just sent", async () => {
  const { p, lively } = mounted(TIMELINE);
  p.win.dispatchEvent(new p.win.WheelEvent("wheel", { deltaY: 40 }));
  append(p, "d", 3);
  await p.settle();
  assert.deepEqual(entering(p), []);
  p.win.dispatchEvent(new p.win.WheelEvent("wheel", { deltaY: 40 }));
  lively.sent();
  append(p, "e", 4);
  await p.settle();
  assert.deepEqual(entering(p), ["e"]);
});

test("listEnter: a list that appears later is found by the periodic scan", async () => {
  const { p } = mounted();
  p.doc.body.insertAdjacentHTML("beforeend", TIMELINE);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  append(p, "d", 3);
  await p.settle();
  assert.deepEqual(entering(p), ["d"]);
});

test("suspend: while the host measures (bbim's hints), nothing new starts", async () => {
  const { p, lively } = mounted(`${TIMELINE}<div class="thread"></div><button class="send"></button>`);
  p.root.setAttribute("data-measuring", "");
  append(p, "d", 3);
  await p.settle();
  assert.deepEqual(entering(p), []);
  assert.equal(lively.pulseStatus(p.doc.querySelector(".thread") as Element, "error"), false);
  lively.sent();
  assert.equal(p.doc.querySelectorAll(`.${CLASSES.send}`).length, 0);
  p.root.removeAttribute("data-measuring");
  assert.equal(lively.pulseStatus(p.doc.querySelector(".thread") as Element, "error"), true);
});

test("sendPulse: a send ripples the send button once, and the class goes when the animation ends", () => {
  const { p, lively } = mounted(`<button class="send"></button>`);
  lively.sent();
  const button = p.doc.querySelector(".send") as Element;
  assert.ok(button.classList.contains(CLASSES.send));
  button.dispatchEvent(new p.win.Event("animationend", { bubbles: true }));
  assert.ok(!button.classList.contains(CLASSES.send));
});

test("statusPulse: a tone attribute for the ring color; a running ring is not restarted", () => {
  const { p, lively } = mounted(`<div class="thread"></div>`);
  const row = p.doc.querySelector(".thread") as Element;
  assert.equal(lively.pulseStatus(row, "waiting"), true);
  assert.equal(row.getAttribute("data-lively-tone"), "waiting");
  assert.equal(lively.pulseStatus(row, "success"), false);
  lively.setSettings({ effects: { statusPulse: false } });
  row.dispatchEvent(new p.win.Event("animationend"));
  assert.equal(lively.pulseStatus(row, "success"), false, "switched off");
});

test("press: releasing a pressable springs it back; an excluded one is left alone", () => {
  const { p } = mounted(`<button id="go"><span id="label">Go</span></button><button id="drag" data-drag-handle></button>`);
  p.doc.getElementById("label")?.dispatchEvent(new p.win.PointerEvent("pointerup", { bubbles: true }));
  assert.ok(p.doc.getElementById("go")?.classList.contains(CLASSES.pressOut));
  p.doc.getElementById("drag")?.dispatchEvent(new p.win.PointerEvent("pointerup", { bubbles: true }));
  assert.ok(!p.doc.getElementById("drag")?.classList.contains(CLASSES.pressOut));
});

test("toggles: a checkbox pops when it becomes checked, not when it is cleared", async () => {
  const { p } = mounted(`<button role="checkbox" aria-checked="false" id="box"></button>`);
  const box = p.doc.getElementById("box") as Element;
  box.addEventListener("click", () => box.setAttribute("aria-checked", box.getAttribute("aria-checked") === "true" ? "false" : "true"));
  (box as HTMLElement).click();
  await p.settle();
  assert.ok(box.classList.contains(CLASSES.check));
  box.dispatchEvent(new p.win.Event("animationend"));
  (box as HTMLElement).click();
  await p.settle();
  assert.ok(!box.classList.contains(CLASSES.check));
});

test("a second mount replaces the first stylesheet instead of doubling it", () => {
  const { p } = mounted();
  const again = new AbortController();
  createLively({ window: p.win, signal: again.signal, targets: TARGETS });
  assert.equal(p.doc.querySelectorAll(`style[${STYLE_ATTRIBUTE}]`).length, 1);
  again.abort();
});

/** Pin an element's box (happy-dom lays nothing out). */
function pinBox(element: Element, right: number, bottom: number): void {
  (element as HTMLElement).getBoundingClientRect = () => ({ right, bottom }) as DOMRect;
}

const REACH_HTML = `<div class="page"><div class="scroller"><div class="dock"></div></div></div><div class="dock"></div>`;

test("reach: the dock band's art reaches its thread view's corner past a scrollbar, and is measured again on demand", () => {
  const p = page(REACH_HTML);
  cleanup.push(() => p.close());
  const view = p.doc.querySelector(".page") as HTMLElement;
  const band = p.doc.querySelector(".page .dock") as HTMLElement;
  const stray = p.doc.querySelector("body > .dock") as HTMLElement;
  pinBox(view, 1600, 1000);
  pinBox(band, 1589, 1000);
  const reach = createReachWatcher({ win: p.win, targets: TARGETS });
  assert.equal(band.style.getPropertyValue(REACH.right), "11px");
  assert.equal(band.style.getPropertyValue(REACH.bottom), "0px");
  // A band outside any view is left alone.
  assert.equal(stray.style.getPropertyValue(REACH.right), "");
  // The scrollbar goes away (or the view resizes): measured again.
  pinBox(band, 1600, 1000);
  reach.measure();
  assert.equal(band.style.getPropertyValue(REACH.right), "0px");
  reach.dispose();
  assert.equal(band.style.getPropertyValue(REACH.right), "");
  assert.equal(band.style.getPropertyValue(REACH.bottom), "");
});

test("reach: a band bb mounts or swaps in later is found by the mutation, without polling", async () => {
  const p = page(`<div class="page"><div class="scroller"></div></div>`);
  cleanup.push(() => p.close());
  const reach = createReachWatcher({ win: p.win, targets: TARGETS });
  cleanup.push(() => reach.dispose());
  const view = p.doc.querySelector(".page") as HTMLElement;
  pinBox(view, 1600, 1000);
  // happy-dom lays nothing out: pin the band's box as it is created.
  const created = p.doc.createElement("div");
  created.className = "dock";
  pinBox(created, 1589, 1000);
  p.doc.querySelector(".scroller")?.append(created);
  await p.settle();
  assert.equal(created.style.getPropertyValue(REACH.right), "11px");
});

test("reach: createLively runs the watcher and removes what it wrote", () => {
  const { p, controller } = mounted(REACH_HTML);
  const band = p.doc.querySelector(".page .dock") as HTMLElement;
  assert.equal(band.style.getPropertyValue(REACH.right), "0px");
  controller.abort();
  assert.equal(band.style.getPropertyValue(REACH.right), "");
});
