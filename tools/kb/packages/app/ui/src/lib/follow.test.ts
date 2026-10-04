import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MouseEvent as ReactMouseEvent } from "react";
import { installDomGlobals, type InstalledDom } from "@kb/ui-test-kit";
import {
  bulletClickIntent,
  renderInlineMarkdown,
  routePointerClick,
  type FollowHow,
  type FollowTarget,
} from "@kb/ui-sdk";

/** No graph behind the text: every reference keeps the default link colour. */
const PLAIN_INK = (): string | null => null;

describe("the one bullet rule", () => {
  const plain = { metaKey: false, ctrlKey: false, shiftKey: false };
  it("a plain click toggles a bullet that can toggle", () => {
    expect(bulletClickIntent(plain, true)).toBe("toggle");
  });
  it("a modifier click always follows", () => {
    expect(bulletClickIntent({ ...plain, metaKey: true }, true)).toBe("open");
    expect(bulletClickIntent({ ...plain, ctrlKey: true }, true)).toBe("open");
  });
  it("a Shift-click follows into a pane beside this one", () => {
    expect(bulletClickIntent({ ...plain, shiftKey: true }, true)).toBe("beside");
    expect(bulletClickIntent({ ...plain, shiftKey: true }, false)).toBe("beside");
  });
  it("a bullet with nothing to toggle follows on a plain click", () => {
    expect(bulletClickIntent(plain, false)).toBe("open");
  });
});

/** A click event shaped the way React hands one over. */
function click(target: Element, mod = false, shift = false) {
  const flags = { stopped: false, prevented: false };
  const event = {
    target,
    metaKey: mod,
    ctrlKey: false,
    shiftKey: shift,
    stopPropagation: () => {
      flags.stopped = true;
    },
    preventDefault: () => {
      flags.prevented = true;
    },
  };
  return { event: event as unknown as ReactMouseEvent, flags };
}

function render(text: string): HTMLElement {
  const host = document.createElement("div");
  renderInlineMarkdown(host, text, PLAIN_INK);
  return host;
}

describe("routing a click on rendered pointers", () => {
  let dom: InstalledDom;
  beforeAll(() => {
    dom = installDomGlobals();
  });
  afterAll(() => dom.restore());

  it("a reference is followed: opened on a plain click, revealed on a modifier click", () => {
    const pill = render("see [[n.x|X]] here").querySelector("[data-kb-ref-id]");
    if (pill === null) throw new Error("no pill");
    const seen: Array<[FollowTarget, FollowHow]> = [];
    const follow = (t: FollowTarget, how: FollowHow) => seen.push([t, how]);

    const plain = click(pill);
    expect(routePointerClick(plain.event, follow)).toBe(true);
    expect(plain.flags).toEqual({ stopped: true, prevented: true });
    expect(routePointerClick(click(pill, true).event, follow)).toBe(true);
    expect(routePointerClick(click(pill, false, true).event, follow)).toBe(true);
    expect(seen).toEqual([
      [{ kind: "node", id: "n.x" }, "open"],
      [{ kind: "node", id: "n.x" }, "reveal"],
      [{ kind: "node", id: "n.x" }, "beside"],
    ]);
  });

  it("a real link keeps its click: the browser opens it", () => {
    const link = render("[kb](https://kb.example)").querySelector("a.kb-md-link");
    if (link === null) throw new Error("no link");
    const seen: FollowTarget[] = [];
    const { event, flags } = click(link);
    expect(routePointerClick(event, (t) => seen.push(t))).toBe(true);
    expect(seen).toEqual([]);
    expect(flags).toEqual({ stopped: true, prevented: false });
  });

  it("plain text is not a pointer's business", () => {
    const host = render("just words");
    const seen: FollowTarget[] = [];
    expect(routePointerClick(click(host).event, (t) => seen.push(t))).toBe(false);
    expect(seen).toEqual([]);
  });
});
