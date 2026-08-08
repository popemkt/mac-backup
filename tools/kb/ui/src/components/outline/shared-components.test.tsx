/**
 * W8b shared row/chip/field components — invariant #1 enforcement tests.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CircleHalf } from "@phosphor-icons/react";
import { FieldRow } from "./field-row";
import { TagChip } from "./tag-chip";
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
    expect(html).toContain("kb-chip");
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

  it("FieldRow is reused by Preferences via PrefFieldRow depth −1 anatomy", () => {
    const outlineHtml = renderToStaticMarkup(
      createElement(
        FieldRow,
        {
          depth: 0,
          fieldType: "str",
          label: "status",
          children: createElement("span", null, "doing"),
        },
      ),
    );
    const prefHtml = renderToStaticMarkup(
      createElement(
        FieldRow,
        {
          depth: -1,
          icon: CircleHalf,
          label: "theme",
          children: createElement("select", null, createElement("option", null, "system")),
        },
      ),
    );
    expect(outlineHtml).toContain('data-field-row="true"');
    expect(outlineHtml).toContain("status");
    expect(outlineHtml).toMatch(/padding-left:\s*24px/);
    expect(prefHtml).toMatch(/padding-left:\s*0px/);
    expect(prefHtml).toContain("theme");
    expect(outlineHtml).toContain("text-[14.5px]");
    expect(prefHtml).toContain("text-[14.5px]");
  });

  it("surface modules import the single shared row/chip/field components", () => {
    expect(readOutlineSource("node-block.tsx")).toMatch(/from "\.\/node-row"/);
    expect(readOutlineSource("node-content.tsx")).toMatch(/from "\.\/tag-chip"/);
    expect(readOutlineSource("references-section.tsx")).toMatch(/from "\.\/node-row"/);
    expect(readOutlineSource("references-section.tsx")).toMatch(/from "\.\/tag-chip"/);
    expect(readOutlineSource("field-value.tsx")).toMatch(/from "\.\/node-row"/);
    expect(readOutlineSource("field-value.tsx")).toMatch(/from "\.\/tag-chip"/);
    expect(readOutlineSource("fields-section.tsx")).toMatch(/from "\.\/field-row"/);
    expect(readOutlineSource("query-results.tsx")).toMatch(/from "\.\/node-block"/);
    expect(readOutlineSource("schema-section.tsx")).toMatch(/from "\.\/node-row"/);
  });

  it("node-block encodes §1.3 guide-line metrics (depth*24+2, left-[9px], w-5, bottom-2)", () => {
    const src = readOutlineSource("node-block.tsx");
    expect(src).toMatch(/depth \* 24 \+ 2/);
    expect(src).toContain("left-[9px]");
    expect(src).toContain("w-5");
    expect(src).toContain("bottom-2");
  });
});
