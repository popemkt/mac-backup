/**
 * W8b shared row/chip/field components — invariant #1 enforcement tests.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CircleHalfIcon } from "@phosphor-icons/react";
import { FieldRow } from "./field-row";
import { TagChip, TagChipGroup } from "./tag-chip";
import { hashTagColor, resolveTagColor } from "@/lib/tag-color";

const outlineDir = path.dirname(fileURLToPath(import.meta.url));

function readOutlineSource(name: string): string {
  return readFileSync(path.join(outlineDir, name), "utf8");
}

describe("shared outline components (W8b)", () => {
  it("TagChip uses deterministic hash colors with hex+18 background", () => {
    const color = hashTagColor("tag.todo");
    const html = renderToStaticMarkup(
      createElement(TagChip, {
        tag: { id: "tag.todo", name: "todo", color },
      }),
    );
    expect(html).toContain(`${color}18`);
    expect(html).toContain(`color:${color}`);
    expect(html).toContain("kb-tag");
    // Height comes from --tag-h on .kb-tag, so the chip must not restate one.
    expect(html).not.toMatch(/h-\[\d+px\]/);
    expect(html).toContain("data-tag-chip");
  });

  it("TagChip exposes navigation and remove as keyboard-reachable buttons", () => {
    const html = renderToStaticMarkup(
      createElement(TagChip, {
        tag: { id: "tag.todo", name: "todo", color: "#112233" },
        onClick: () => undefined,
        onRemove: () => undefined,
      }),
    );
    expect(html).toContain('aria-label="Go to tag todo"');
    expect(html).toContain('aria-label="Remove tag todo"');
    expect(html.match(/<button/g) ?? []).toHaveLength(2);
  });

  it("TagChip remove uses hash-overlay (opacity), never display toggle", () => {
    const html = renderToStaticMarkup(
      createElement(TagChip, {
        tag: { id: "tag.todo", name: "todo", color: "#112233" },
        onRemove: () => undefined,
      }),
    );
    expect(html).toContain("data-tag-remove");
    expect(html).toContain("absolute");
    expect(html).toContain("opacity-0");
    expect(html).toContain("group-hover/tag:opacity-60");
    expect(html).not.toContain("group-hover/tag:flex");
    // Remove is not a flex sibling that appears on hover — mark slot is fixed.
    expect(html).toContain("data-tag-mark");
  });

  it("TagChip has no configure affordance", () => {
    const html = renderToStaticMarkup(
      createElement(TagChip, {
        tag: { id: "tag.todo", name: "todo", color: "#112233" },
        onClick: () => undefined,
      }),
    );
    expect(html).not.toContain("Configure tag");
    expect(html).not.toContain("GearSix");
    expect(readOutlineSource("tag-chip.tsx")).not.toContain("GearSix");
    expect(readOutlineSource("tag-chip.tsx")).not.toContain("onConfigure");
    expect(readOutlineSource("tag-chip.tsx")).not.toContain("onTagConfigure");
  });

  it("TagChipGroup wraps without fixed height", () => {
    const color = hashTagColor("tag.todo");
    const html = renderToStaticMarkup(
      createElement(TagChipGroup, {
        tags: [
          { id: "t1", name: "todo", color },
          { id: "t2", name: "urgent", color },
          { id: "t3", name: "work", color },
        ],
      }),
    );
    expect(html).toContain('data-tag-chip-group="true"');
    expect(html).toContain("flex-wrap");
    expect(html).not.toMatch(/\bh-6\b/);
    expect(html).not.toMatch(/h-\[\d+px\]/);
  });

  it("resolveTagColor override wins over hash in TagChip style", () => {
    const html = renderToStaticMarkup(
      createElement(TagChip, {
        tag: {
          id: "tag.todo",
          name: "todo",
          color: resolveTagColor("tag.todo", "#112233"),
        },
      }),
    );
    expect(html).toContain("#11223318");
  });

  it("FieldRow shows mismatch warning icon when flagged", () => {
    const html = renderToStaticMarkup(
      createElement(FieldRow, {
        depth: 0,
        fieldType: "number",
        label: "count",
        mismatch: true,
        children: createElement("span", null, "abc"),
      }),
    );
    expect(html).toContain('data-field-mismatch="true"');
    expect(html).toContain("data-mismatch-warning");
  });

  it("FieldRow is reused by Preferences via PrefFieldRow depth −1 anatomy", () => {
    const outlineHtml = renderToStaticMarkup(
      createElement(FieldRow, {
        depth: 0,
        fieldType: "text",
        label: "status",
        children: createElement("span", null, "doing"),
      }),
    );
    const prefHtml = renderToStaticMarkup(
      createElement(FieldRow, {
        depth: -1,
        icon: CircleHalfIcon,
        label: "theme",
        children: createElement("select", null, createElement("option", null, "system")),
      }),
    );
    expect(outlineHtml).toContain('data-field-row="true"');
    expect(outlineHtml).toContain("status");
    // One indent step for an outline field, none for a popover field — the
    // indent is space before the row, so the row's own box is undecorated at
    // its left edge either way.
    expect(outlineHtml).toMatch(/margin-left:\s*calc\(1 \* var\(--kb-indent\)\)/);
    expect(prefHtml).toMatch(/margin-left:\s*calc\(0 \* var\(--kb-indent\)\)/);
    expect(prefHtml).toContain("theme");
    // Label rides the shared type scale rather than restating it, so a label
    // and the node text next to it can never drift apart again.
    expect(outlineHtml).toContain("kb-text");
    expect(prefHtml).toContain("kb-text");
    expect(outlineHtml).not.toContain("text-[14.5px]");
    expect(prefHtml).not.toContain("text-[14.5px]");
  });

  it("surface modules import the single shared row/chip/field components", () => {
    expect(readOutlineSource("node-block.tsx")).toMatch(/from "\.\/node-row"/);
    expect(readOutlineSource("node-content.tsx")).toMatch(/from "\.\/tag-chip"/);
    expect(readOutlineSource("references-section.tsx")).toMatch(/from "\.\/node-row"/);
    expect(readOutlineSource("references-section.tsx")).toMatch(/from "\.\/tag-chip"/);
    expect(readOutlineSource("field-value.tsx")).toMatch(/from "\.\/node-row"/);
    expect(readOutlineSource("field-value.tsx")).toMatch(/from "\.\/tag-chip"/);
    expect(readOutlineSource("fields-section.tsx")).toMatch(/from "\.\/field-row"/);
    // W8b + import/no-cycle: query results render via the shared NodeBlock, so
    // the recursive node<->query pair must not be a static import cycle. The
    // renderer is inverted (node-block passes renderNode into query-results).
    expect(readOutlineSource("query-results.tsx")).not.toMatch(/from "\.\/node-block"/);
    expect(readOutlineSource("node-block.tsx")).toMatch(/from "\.\/query-results"/);
    expect(readOutlineSource("schema-section.tsx")).toMatch(/from "\.\/node-row"/);
  });

  it("tag render path is TagChip only — no inline striped duplicate (i10 item 3)", () => {
    const content = readOutlineSource("node-content.tsx");
    expect(content).toMatch(/from "\.\/tag-chip"/);
    expect(content).toMatch(/TagChipGroup/);
    // No second ad-hoc tag markup / hardcoded chip sizes in the content row.
    expect(content).not.toMatch(/text-\[1[01]px\].*tag|tag.*text-\[1[01]px\]/i);
    expect(content).not.toMatch(/striped/);
    expect(readOutlineSource("tag-chip.tsx")).toContain("kb-tag");
    expect(readOutlineSource("tag-chip.tsx")).not.toMatch(/text-\[\d+px\]/);
  });

  it("node-block encodes §1.3 guide-line metrics (indent+2, left-[9px], w-5, bottom-2)", () => {
    const src = readOutlineSource("node-block.tsx");
    // The offset itself lives with the rest of the indent geometry.
    expect(src).toMatch(/guideLineStyle\(depth\)/);
    const indent = readFileSync(path.join(outlineDir, "../../lib/indent.ts"), "utf8");
    expect(indent).toMatch(/var\(--kb-indent\)/);
    expect(indent).toMatch(/\+ 2px/);
    expect(src).toContain("left-[9px]");
    expect(src).toContain("w-5");
    expect(src).toContain("bottom-2");
  });
});
