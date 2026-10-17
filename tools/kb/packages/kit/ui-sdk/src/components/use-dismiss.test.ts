/**
 * The dismiss stack reads what a popover's last commit rendered: its parts
 * and its dismiss as they are now, not as they were when it opened, through
 * plain callbacks the window's listeners call. What every popover promises
 * is the dismiss contract's (`@kb/ui-test-kit`), run over each one.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDismiss } from "./use-dismiss";

function Popover({ inside, onDismiss }: { inside: string; onDismiss: () => void }) {
  useDismiss(true, { inside: [inside], trigger: null }, onDismiss);
  return createElement("div", { "data-a": "", "data-b": "" });
}

describe("useDismiss", () => {
  let dom: Window;
  beforeEach(() => {
    dom = new Window();
    vi.stubGlobal("window", dom);
    vi.stubGlobal("document", dom.document);
    vi.stubGlobal("Node", dom.Node);
    vi.stubGlobal("Element", dom.Element);
    vi.stubGlobal("HTMLElement", dom.HTMLElement);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dismisses through the parts and the dismiss of the last commit", () => {
    const host = dom.document.createElement("div");
    const elsewhere = dom.document.createElement("div");
    dom.document.body.append(host, elsewhere);
    const root = createRoot(host as unknown as HTMLElement);
    const calls: string[] = [];
    act(() =>
      root.render(
        createElement(Popover, { inside: "[data-a]", onDismiss: () => calls.push("first") }),
      ),
    );
    act(() =>
      root.render(
        createElement(Popover, { inside: "[data-c]", onDismiss: () => calls.push("second") }),
      ),
    );
    const press = (target: { dispatchEvent: (event: never) => boolean }) =>
      act(() => {
        target.dispatchEvent(
          new dom.PointerEvent("pointerdown", { bubbles: true, cancelable: true }) as never,
        );
      });
    // The panel is no longer inside by the parts it renders now: a press there dismisses.
    const panel = host.querySelector("[data-a]");
    if (panel === null) throw new Error("the popover did not render");
    press(panel);
    expect(calls).toEqual(["second"]);
    act(() => root.unmount());
    press(elsewhere);
    expect(calls).toEqual(["second"]);
  });
});
