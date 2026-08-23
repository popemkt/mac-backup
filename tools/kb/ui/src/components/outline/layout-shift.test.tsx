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
    expect(withRemove).toContain("w-[9px]");

    // Label + mark anatomy matches the no-remove chip (only overlay button added).
    expect(withRemove).toContain(">todo</span>");
    expect(withoutRemove).toContain(">todo</span>");
    expect(withRemove).toContain("h-[12px]");
    expect(withoutRemove).toContain("h-[12px]");

    const src = readFileSync(path.join(outlineDir, "tag-chip.tsx"), "utf8");
    expect(src).toContain("absolute inset-0");
    expect(src).not.toMatch(/hidden[\s\S]*group-hover\/tag:flex/);
  });

  it("FieldRow remove button reserves width via opacity (not display)", () => {
    const html = renderToStaticMarkup(
      createElement(
        FieldRow,
        {
          depth: 0,
          label: "status",
          onRemove: () => undefined,
          children: createElement("span", null, "doing"),
        },
      ),
    );
    expect(html).toContain("opacity-0");
    expect(html).toContain("group-hover/field:opacity-100");
    expect(html).toContain("w-5");
    expect(html).not.toMatch(/hidden[\s\S]*group-hover\/field/);
  });

  it("CommandPalette shell keeps fixed max width empty and matched", () => {
    const src = readFileSync(
      path.join(outlineDir, "../palette/command-palette.tsx"),
      "utf8",
    );
    expect(src).toMatch(/w-full max-w-\[520px\]/);
    expect(src).toMatch(/max-h-\[min\(20\*2rem,50vh\)\]/);
  });

  it("node command palette always occupies the list slot", () => {
    const src = readFileSync(
      path.join(outlineDir, "node-command-palette.tsx"),
      "utf8",
    );
    expect(src).toContain('data-palette-list="true"');
    expect(src).toContain("min-h-[2.5rem]");
    expect(src).not.toMatch(/items\.length > 0 && \(/);
  });
});
