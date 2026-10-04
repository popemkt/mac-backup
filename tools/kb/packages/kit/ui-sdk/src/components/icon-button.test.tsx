/**
 * The icon button owns its box and its glyph together, so two buttons of one
 * size cannot differ in either — which is how a field's remove "×" and add
 * "+" came to sit a pixel apart at two sizes.
 */
import { PlusIcon, XIcon } from "@phosphor-icons/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IconButton } from "./icon-button";

const render = (props: Parameters<typeof IconButton>[0]) =>
  renderToStaticMarkup(createElement(IconButton, props));

/** The class list and glyph size, which is what "the same button" means. */
function shapeOf(html: string) {
  const cls = /class="([^"]*)"/.exec(html)?.[1];
  const glyph = /<svg[^>]*width="(\d+)"/.exec(html)?.[1];
  return { cls, glyph };
}

describe("IconButton", () => {
  it("is a labelled button whose tooltip is its label unless it says more", () => {
    const html = render({ label: "Add a value", icon: PlusIcon });
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Add a value"');
    expect(html).toContain('title="Add a value"');
    expect(render({ label: "Pin", title: "Pin: stay a member", icon: PlusIcon })).toContain(
      'title="Pin: stay a member"',
    );
  });

  it("draws one box and one glyph size per size, whatever the glyph", () => {
    const plus = shapeOf(render({ label: "Add", icon: PlusIcon }));
    const x = shapeOf(render({ label: "Remove", icon: XIcon }));
    expect(x).toEqual(plus);
    const md = shapeOf(render({ label: "Configure", icon: XIcon, size: "md" }));
    expect(md.cls).toContain("h-6 w-6");
    expect(Number(md.glyph)).toBeGreaterThan(Number(plus.glyph));
  });

  it("lets a caller place or reveal it without restyling the box", () => {
    const html = render({ label: "Add", icon: PlusIcon, className: "opacity-0" });
    expect(html).toContain("opacity-0");
    expect(html).toContain("hover:bg-foreground/[0.06]");
  });
});
