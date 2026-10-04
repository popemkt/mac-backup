import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomGlobals, type InstalledDom } from "@kb/ui-test-kit";
import { initScrollbarManager } from "./scrollbar-manager";

describe("scrollbar manager", () => {
  let dom: InstalledDom;

  beforeAll(() => {
    vi.useFakeTimers();
    dom = installDomGlobals();
    initScrollbarManager();
  });

  afterAll(() => {
    dom.restore();
    vi.useRealTimers();
  });

  function scroller(): HTMLElement {
    const el = dom.window.document.createElement("div") as unknown as HTMLElement;
    dom.window.document.body.appendChild(el as unknown as never);
    return el;
  }

  function scroll(el: HTMLElement): void {
    el.dispatchEvent(new dom.window.Event("scroll") as unknown as Event);
  }

  it("marks a scrolling element once, not on every scroll event", () => {
    const el = scroller();
    const writes = vi.spyOn(el, "setAttribute");
    for (let i = 0; i < 20; i++) scroll(el);
    expect(el.getAttribute("data-scrolling")).toBe("true");
    expect(writes).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(el.hasAttribute("data-scrolling")).toBe(false);
  });

  it("settles each element on its own timer", () => {
    const first = scroller();
    const second = scroller();
    scroll(first);
    scroll(second);
    vi.advanceTimersByTime(1000);
    expect(first.hasAttribute("data-scrolling")).toBe(false);
    expect(second.hasAttribute("data-scrolling")).toBe(false);
  });
});
