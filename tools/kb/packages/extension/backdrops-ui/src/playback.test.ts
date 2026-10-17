import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installDomGlobals, type InstalledDom } from "@kb/ui-test-kit";
import { watchPlayback } from "./playback";

/** An IntersectionObserver the test drives by hand. */
class FakeObserver {
  static current: FakeObserver | null = null;
  readonly callback: (entries: { isIntersecting: boolean }[]) => void;
  constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
    this.callback = callback;
    FakeObserver.current = this;
  }
  observe() {}
  disconnect() {
    FakeObserver.current = null;
  }
  show(isIntersecting: boolean) {
    this.callback([{ isIntersecting }]);
  }
}

describe("watchPlayback", () => {
  let installed: InstalledDom;
  beforeEach(() => {
    installed = installDomGlobals();
    (globalThis as Record<string, unknown>).IntersectionObserver = FakeObserver;
  });
  afterEach(() => {
    installed.restore();
    delete (globalThis as Record<string, unknown>).IntersectionObserver;
  });

  it("plays while visible and on screen, and tells each change once", () => {
    const heard: boolean[] = [];
    const watch = watchPlayback(document.createElement("div"), false, (p) => heard.push(p));
    expect(watch.playing()).toBe(true);
    FakeObserver.current?.show(false);
    FakeObserver.current?.show(false);
    FakeObserver.current?.show(true);
    expect(heard).toEqual([false, true]);
    watch.dispose();
    expect(FakeObserver.current).toBeNull();
  });

  it("never plays under reduced motion", () => {
    const heard: boolean[] = [];
    const watch = watchPlayback(document.createElement("div"), true, (p) => heard.push(p));
    FakeObserver.current?.show(true);
    expect(watch.playing()).toBe(false);
    expect(heard).toEqual([false]);
    watch.dispose();
  });
});
