/**
 * The dismiss contract: what every popover, menu and picker that floats over
 * the page promises (DESIGN-UI.md → Cross-surface polish → Popovers dismiss
 * one way), as one suite each package runs over the popovers it renders.
 * Each is keyed by the file that renders it, from the workspace root, and
 * every file that dismisses through `useDismiss` is a key of some package's
 * suite (the harness's `popover-dismiss-coverage` check).
 *
 * - a press inside it leaves it open;
 * - a press on its own trigger, while it is open, closes it exactly once:
 *   the trigger's click closes it, and nothing opens it again;
 * - a press outside it dismisses it, even one a handler there stops;
 * - Escape dismisses it and reaches nothing else: no listener below the
 *   window, in either phase, and none on the window added after it opened;
 * - Escape gives focus back to what had it as the popover opened;
 * - a popover opened over it is dismissed first: a press in that one
 *   leaves both open, and Escape dismisses that one, then this one.
 */
import { act, createElement, useState, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { useDismiss } from "@kb/ui-sdk";
import { installDomGlobals, type InstalledDom } from "./dom-globals";

/** A popover rendered open, as the suite reaches it. */
export interface OpenPopover {
  /** Its panel while it is open; null once it is dismissed. */
  readonly panel: () => Element | null;
  /**
   * The control whose click toggles it, or null for a popover nothing
   * toggles (one a command, a key or a gesture opens): every popover says.
   */
  readonly trigger: (() => HTMLElement | null) | null;
  /** Take down whatever the mount rendered. */
  readonly unmount: () => void;
}

/** Render one popover open on `host`, a fresh element on the body. */
export type PopoverMount = (host: HTMLElement) => OpenPopover | Promise<OpenPopover>;

/**
 * Render `element` on `host` and, when it has one, click its `trigger`
 * (found in the document once rendered) to open it: the popover whose panel
 * `panel` finds. Null for a popover nothing toggles, which `element` renders
 * open.
 */
export function renderPopover(
  host: HTMLElement,
  element: ReactElement,
  panel: () => Element | null,
  trigger: (() => HTMLElement | null) | null,
): OpenPopover {
  const root = createRoot(host);
  act(() => root.render(element));
  if (trigger !== null) act(() => trigger()?.click());
  return { panel, trigger, unmount: () => root.unmount() };
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

/** Escape pressed where focus is, as the page hears it. */
function escape(): void {
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
}

/** A second popover, opened over the one under test. */
function Over(): ReactNode {
  const [open, setOpen] = useState(true);
  useDismiss(open, { inside: ["[data-over]"], trigger: null }, () => setOpen(false));
  return open ? createElement("div", { "data-over": "" }) : null;
}

/** A fresh element on the body to render on. */
function hostOnBody(): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  return host;
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
      shown = await mount(hostOnBody());
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

    it("is closed exactly once by a press on its own trigger", async () => {
      const popover = await open();
      panelOf(popover);
      if (popover.trigger === null) return;
      const trigger = popover.trigger();
      if (trigger === null) throw new Error("the popover's trigger is not on the page");
      // A press, then the click it ends in, as a person presses the trigger.
      press(trigger);
      act(() => trigger.click());
      expect(popover.panel()).toBeNull();
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
      const heard: string[] = [];
      const hearing = (where: string) => (e: KeyboardEvent) => heard.push(`${where} ${e.key}`);
      // Capture listeners, the earliest a handler can hear: the document's
      // added before it opened, the window's after.
      const onDocument = hearing("document");
      document.addEventListener("keydown", onDocument, true);
      const popover = await open();
      panelOf(popover);
      const onWindow = hearing("window");
      window.addEventListener("keydown", onWindow, true);
      try {
        escape();
      } finally {
        document.removeEventListener("keydown", onDocument, true);
        window.removeEventListener("keydown", onWindow, true);
      }
      expect(popover.panel()).toBeNull();
      expect(heard).toEqual([]);
    });

    it("gives focus back on Escape to what had it as it opened", async () => {
      const opener = document.createElement("button");
      document.body.append(opener);
      opener.focus();
      panelOf(await open());
      escape();
      expect(document.activeElement).toBe(opener);
    });

    it("is dismissed after a popover opened over it, which a press in leaves both open", async () => {
      const popover = await open();
      panelOf(popover);
      const over = renderPopover(
        hostOnBody(),
        createElement(Over),
        () => document.querySelector("[data-over]"),
        null,
      );
      try {
        press(panelOf(over));
        expect([popover.panel(), over.panel()].map((panel) => panel !== null)).toEqual([
          true,
          true,
        ]);
        escape();
        expect([popover.panel(), over.panel()].map((panel) => panel !== null)).toEqual([
          true,
          false,
        ]);
        escape();
        expect(popover.panel()).toBeNull();
      } finally {
        act(() => over.unmount());
      }
    });
  });
}
