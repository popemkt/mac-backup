import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MouseEvent as ReactMouseEvent } from "react";
import { installDomGlobals, type InstalledDom } from "@/test-support/dom-globals";
import {
  bulletClickIntent,
  routePointerClick,
  type FollowHow,
  type FollowTarget,
} from "@/lib/follow";
import { renderInlineMarkdown } from "@/lib/md-edit";

describe("the one bullet rule", () => {
  const plain = { metaKey: false, ctrlKey: false };
  it("a plain click toggles a bullet that can toggle", () => {
    expect(bulletClickIntent(plain, true)).toBe("toggle");
  });
  it("a modifier click always follows", () => {
    expect(bulletClickIntent({ metaKey: true, ctrlKey: false }, true)).toBe("follow");
    expect(bulletClickIntent({ metaKey: false, ctrlKey: true }, true)).toBe("follow");
  });
  it("a bullet with nothing to toggle follows on a plain click", () => {
    expect(bulletClickIntent(plain, false)).toBe("follow");
  });
});

/** A click event shaped the way React hands one over. */
function click(target: Element, mod = false) {
  const flags = { stopped: false, prevented: false };
  const event = {
    target,
    metaKey: mod,
    ctrlKey: false,
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
  renderInlineMarkdown(host, text);
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
    expect(seen).toEqual([
      [{ kind: "node", id: "n.x" }, "open"],
      [{ kind: "node", id: "n.x" }, "reveal"],
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
