/**
 * i10 item 2 — layout-shift regression: hover/state must not change measured
 * width of tag chips, palette shell, or field rows.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TagChip } from "./tag-chip";
import { FieldRow } from "./field-row";

const outlineDir = path.dirname(fileURLToPath(import.meta.url));

describe("layout-shift regressions (i10)", () => {
  it("TagChip remove overlay never changes chip width on hover", () => {
    const withRemove = renderToStaticMarkup(
      createElement(TagChip, {
        tag: { id: "tag.todo", name: "todo", color: "#8b5cf6" },
        onClick: () => undefined,
        onRemove: () => undefined,
      }),
    );
    const withoutRemove = renderToStaticMarkup(
      createElement(TagChip, {
        tag: { id: "tag.todo", name: "todo", color: "#8b5cf6" },
        onClick: () => undefined,
      }),
    );

    // Remove control is present but absolutely positioned in a fixed mark slot.
    expect(withRemove).toContain('data-tag-chip="true"');
    expect(withRemove).toContain('data-tag-remove="true"');
    expect(withRemove).toContain("absolute inset-0");
    expect(withRemove).toContain("opacity-0");
    expect(withRemove).toContain("group-hover/tag:opacity-60");
    expect(withRemove).not.toContain("group-hover/tag:flex");
    expect(withRemove).toContain('data-tag-mark="true"');
    // Mark scales in em off --tag-size rather than pinning its own px box.
    expect(withRemove).toContain("w-[1em]");

    // Label + mark anatomy matches the no-remove chip (only overlay button added).
    expect(withRemove).toContain(">todo</span>");
    expect(withoutRemove).toContain(">todo</span>");
    // Both carry the same token class; the height itself lives on .kb-tag.
    expect(withRemove).toContain("kb-tag");
    expect(withoutRemove).toContain("kb-tag");
    expect(withRemove).not.toMatch(/h-\[\d+px\]/);
    expect(withoutRemove).not.toMatch(/h-\[\d+px\]/);

    const src = readFileSync(path.join(outlineDir, "tag-chip.tsx"), "utf8");
    expect(src).toContain("absolute inset-0");
    expect(src).not.toMatch(/hidden[\s\S]*group-hover\/tag:flex/);
  });

  it("FieldRow remove button reserves width via opacity (not display)", () => {
    const html = renderToStaticMarkup(
      createElement(FieldRow, {
        depth: 0,
        label: "status",
        onRemove: () => undefined,
        children: createElement("span", null, "doing"),
      }),
    );
    expect(html).toContain("opacity-0");
    expect(html).toContain("group-hover/field:opacity-100");
    expect(html).toContain("w-5");
    expect(html).not.toMatch(/hidden[\s\S]*group-hover\/field/);
  });

  it("CommandPalette shell keeps fixed max width empty and matched", () => {
    const src = readFileSync(path.join(outlineDir, "../palette/command-palette.tsx"), "utf8");
    expect(src).toMatch(/w-full max-w-\[520px\]/);
    expect(src).toMatch(/max-h-\[min\(20\*2rem,50vh\)\]/);
  });

  it("node command palette always occupies the list slot", () => {
    const src = readFileSync(path.join(outlineDir, "node-command-palette.tsx"), "utf8");
    expect(src).toContain('data-palette-list="true"');
    expect(src).toContain("min-h-[2.5rem]");
    expect(src).not.toMatch(/items\.length > 0 && \(/);
  });

  it("the main scroll region reserves its scrollbar gutter", () => {
    const src = readFileSync(path.join(outlineDir, "../App.tsx"), "utf8");
    // One owner of "the main region" — the className is not restated per route.
    expect(src).toMatch(/function MainRegion\(/);
    expect((src.match(/<main\b/g) ?? []).length).toBe(1);
    expect(src).not.toMatch(/className="min-h-0 flex-1 overflow-(?:auto|hidden)"/);
    // Every route's region goes through it, canvas (non-scrolling) included.
    expect((src.match(/<MainRegion\b/g) ?? []).length).toBe(4);
    // The track is reserved unconditionally, so a view that overflows and one
    // that does not resolve to the same content width — the centered column,
    // and with it the breadcrumb, cannot shift by the 6px scrollbar.
    expect(src).toMatch(/overflow-y-scroll/);
    // Reserved by always-on scroll, not by scrollbar-gutter: the property is
    // unsupported before Safari 18.2, which would leave the shift in place
    // there. One mechanism, so the two cannot drift apart.
    expect(src).not.toMatch(/\[scrollbar-gutter:/);
    // Pinned at the region itself, so a later edit cannot quietly drop back to
    // `overflow-auto` (the unrelated `<pre>` in the error view may keep it).
    expect(src).toMatch(/scroll \? "overflow-x-auto overflow-y-scroll"/);
    // And the shift is fixed at the scroll region, not compensated downstream.
    const crumbs = readFileSync(path.join(outlineDir, "breadcrumbs.tsx"), "utf8");
    expect(crumbs).not.toMatch(/scrollbar|margin-left|\bml-|padding-right|\bpr-/);
  });
});
