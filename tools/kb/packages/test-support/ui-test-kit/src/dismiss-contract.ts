/**
 * The dismiss contract: what every popover, menu and picker that floats over
 * the page promises (DESIGN-UI.md → Cross-surface polish → Popovers dismiss
 * one way), as one suite each package runs over the popovers it renders.
 * Each is keyed by the file that renders it, from the workspace root, and
 * every file that dismisses through `useDismiss` is a key of some package's
 * suite (the harness's `popover-dismiss-coverage` check).
 *
 * - a press inside it leaves it open;
 * - a press outside it dismisses it, even one a handler there stops;
 * - Escape dismisses it and reaches nothing else.
 */
import { act, useState, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { installDomGlobals, type InstalledDom } from "./dom-globals";

/** A popover rendered open, as the suite reaches it. */
export interface OpenPopover {
  /** Its panel while it is open; null once it is dismissed. */
  readonly panel: () => Element | null;
  /** Take down whatever the mount rendered. */
  readonly unmount: () => void;
}

/** Render one popover open on `host`, a fresh element on the body. */
export type PopoverMount = (host: HTMLElement) => OpenPopover | Promise<OpenPopover>;

/**
 * Render `element` on `host` and, when given, press `trigger` (found in the
 * document once rendered) to open it: the popover whose panel `panel` finds.
 */
export function renderPopover(
  host: HTMLElement,
  element: ReactElement,
  panel: () => Element | null,
  trigger?: () => HTMLElement | null,
): OpenPopover {
  const root = createRoot(host);
  act(() => root.render(element));
  if (trigger !== undefined) act(() => trigger()?.click());
  return { panel, unmount: () => root.unmount() };
}

/** Its children, until they ask to be dismissed: a popover opened by its parent's state. */
export function UntilDismissed({
  children,
}: {
  readonly children: (dismiss: () => void) => ReactNode;
}): ReactNode {
  const [open, setOpen] = useState(true);
  return open ? children(() => setOpen(false)) : null;
}

/** The panel of `popover`, which the suite needs while it is open. */
function panelOf(popover: OpenPopover): Element {
  const panel = popover.panel();
  if (panel === null) throw new Error("the popover did not open");
  return panel;
}

/** A press going down on `target`, as the page hears one. */
function press(target: EventTarget): void {
  act(() => {
    target.dispatchEvent(
      new window.PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
  });
}

export function dismissContract(popovers: Readonly<Record<string, PopoverMount>>): void {
  let dom: InstalledDom;
  beforeAll(() => {
    dom = installDomGlobals();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterAll(() => dom.restore());

  describe.each(Object.entries(popovers))("%s dismisses as every popover does", (_file, mount) => {
    let shown: OpenPopover | null = null;
    const open = async () => {
      const host = document.createElement("div");
      document.body.append(host);
      shown = await mount(host);
      return shown;
    };
    afterEach(() => {
      act(() => shown?.unmount());
      shown = null;
      document.body.replaceChildren();
    });

    it("stays open for a press inside it", async () => {
      const popover = await open();
      press(panelOf(popover));
      expect(popover.panel()).not.toBeNull();
    });

    it("is dismissed by a press outside it, even one a handler there stops", async () => {
      const popover = await open();
      panelOf(popover);
      const elsewhere = document.createElement("div");
      elsewhere.addEventListener("pointerdown", (e) => e.stopPropagation());
      document.body.append(elsewhere);
      press(elsewhere);
      expect(popover.panel()).toBeNull();
    });

    it("is dismissed by Escape, which reaches nothing else", async () => {
      const popover = await open();
      panelOf(popover);
      const heard: string[] = [];
      const hear = (e: KeyboardEvent) => heard.push(e.key);
      window.addEventListener("keydown", hear);
      try {
        act(() => {
          (document.activeElement ?? document.body).dispatchEvent(
            new window.KeyboardEvent("keydown", {
              key: "Escape",
              bubbles: true,
              cancelable: true,
            }),
          );
        });
      } finally {
        window.removeEventListener("keydown", hear);
      }
      expect(popover.panel()).toBeNull();
      expect(heard).toEqual([]);
    });
  });
}
