import { present } from "@kb/model";
import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transitionTheme } from "./theme-transition";

describe("theme transitions", () => {
  let dom: Window;
  beforeEach(() => {
    dom = new Window();
    vi.stubGlobal("document", dom.document);
    vi.stubGlobal("window", dom);
  });
  afterEach(() => {
    transitionTheme(() => {}, false);
    vi.unstubAllGlobals();
  });

  it("applies immediately without the snapshot API or when appearance stays the same", () => {
    const update = vi.fn();
    transitionTheme(update, true);
    expect(update).toHaveBeenCalledOnce();
    const start = vi.fn();
    Object.assign(dom.document, { startViewTransition: start });
    transitionTheme(update, false);
    expect(update).toHaveBeenCalledTimes(2);
    expect(start).not.toHaveBeenCalled();
  });

  it("does not capture the screen when reduced motion is requested", () => {
    const start = vi.fn();
    Object.assign(dom.document, { startViewTransition: start });
    vi.spyOn(dom, "matchMedia").mockReturnValue({ matches: true } as ReturnType<
      Window["matchMedia"]
    >);
    const update = vi.fn();
    transitionTheme(update, true);
    expect(update).toHaveBeenCalledOnce();
    expect(start).not.toHaveBeenCalled();
  });

  it("discards superseded choices even if the browser invokes their snapshot callbacks late", async () => {
    const callbacks: Array<() => void> = [];
    const completions: Array<() => void> = [];
    const skip = vi.fn();
    Object.assign(dom.document, {
      startViewTransition: (update: () => void) => {
        callbacks.push(update);
        return {
          skipTransition: skip,
          ready: Promise.resolve(),
          finished: new Promise<void>((resolve) => completions.push(resolve)),
        };
      },
    });
    const first = vi.fn();
    const last = vi.fn();
    transitionTheme(first, true);
    transitionTheme(last, true);
    present(callbacks[0], "first transition")();
    present(callbacks[1], "last transition")();
    expect(first).not.toHaveBeenCalled();
    expect(last).toHaveBeenCalledOnce();
    expect(skip).toHaveBeenCalledOnce();
    for (const complete of completions) complete();
    await Promise.resolve();
    await Promise.resolve();
    expect(dom.document.documentElement.hasAttribute("data-theme-transition")).toBe(false);
  });
});
