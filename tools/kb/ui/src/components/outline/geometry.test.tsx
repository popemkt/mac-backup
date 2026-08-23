/**
 * r1-editor §5.2 — geometry & metric invariant tests.
 * The One-Row Metric Invariant: every row state resolves to identical
 * indent / bullet-slot / content-padding geometry from the token source.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NodeRow } from "./node-row";
import { FieldRow } from "./field-row";
import { PropValueEditor } from "./field-value";
import type { NodeMap, PropValue } from "@/lib/types";

const outlineDir = path.dirname(fileURLToPath(import.meta.url));

function readOutlineSource(name: string): string {
  return readFileSync(path.join(outlineDir, name), "utf8");
}

function renderNodeRowAtDepth(depth: number): string {
  return renderToStaticMarkup(
    createElement(
      NodeRow,
      {
        depth,
        nodeId: "n.x",
        bullet: createElement("span", { className: "bullet-container h-6 w-6" }),
        content: createElement(
          "div",
          { className: "kb-text min-h-6 min-w-0 flex-1" },
          "text",
        ),
      },
    ),
  );
}

describe("One-Row Metric Invariant (§5.2)", () => {
  it("NodeRow indents by depth × 24px with the token row height", () => {
    for (const depth of [0, 1, 3]) {
      const html = renderNodeRowAtDepth(depth);
      expect(html).toMatch(
        new RegExp(`padding-left:\\s*${depth * 24}px`),
      );
      expect(html).toContain("var(--kb-row-h)");
    }
  });

  it("content padding comes from the single px-1 container slot", () => {
    const html = renderNodeRowAtDepth(2);
    // exactly one horizontal padding declaration on node-content
    expect(html.match(/px-1/g)?.length ?? 0).toBe(1);
    expect(html).not.toContain("ghost-row");
  });

  it("bullet slot is the fixed 24px hit area", () => {
    expect(readOutlineSource("bullet.tsx")).toContain("h-6 w-6");
    expect(readOutlineSource("node-block.tsx")).toMatch(/depth \* 24 \+ 2/);
  });

  it("active editor and inactive view share the KB_TEXT_CLASS type scale", () => {
    const src = readOutlineSource("node-content.tsx");
    // Editor branch
    expect(src).toMatch(/KB_TEXT_CLASS/);
    // MdView branch receives the same class via md-view.tsx
    expect(readOutlineSource("md-view.tsx")).toMatch(/KB_TEXT_CLASS/);
    // Field value editors use the shared scale too.
    expect(readOutlineSource("field-value.tsx")).toMatch(/KB_TEXT_CLASS/);
  });
});

describe("Field value placeholder (D17, §5.2)", () => {
  const nodes: NodeMap = new Map();

  it("renders an EMPTY dom with the CSS placeholder class", () => {
    const html = renderToStaticMarkup(
      createElement(PropValueEditor, {
        value: { t: "str", v: "" } as PropValue,
        display: "",
        fieldType: "text",
        onCommit: () => {},
        nodes,
      }),
    );
    expect(html).toContain("empty-placeholder");
    expect(html).toContain('data-empty-placeholder="true"');
    // No literal "Empty" text child — placeholder lives in CSS only.
    expect(html).not.toMatch(/>\s*Empty\s*</);
  });

  it("keeps real values as DOM text without placeholder styling", () => {
    const html = renderToStaticMarkup(
      createElement(PropValueEditor, {
        value: { t: "str", v: "doing" } as PropValue,
        display: "",
        fieldType: "text",
        onCommit: () => {},
        nodes,
      }),
    );
    expect(html).not.toContain("empty-placeholder");
    expect(html).toContain("doing");
  });
});

describe("Field row alignment (D18, §5.2)", () => {
  const base = {
    depth: 1,
    fieldType: "text",
    label: "status",
  } as const;

  function markup(onRemove?: () => void): string {
    return renderToStaticMarkup(
      createElement(
        FieldRow,
        {
          ...base,
          onRemove,
          children: createElement("span", null, "value"),
        },
      ),
    );
  }

  it("value column starts at identical x whether onRemove exists", () => {
    const withBtn = markup(() => {});
    const withoutBtn = markup(undefined);
    // Identical prefix up to and including the opening of the value slot.
    const marker = 'class="min-w-0 flex-1';
    const iWith = withBtn.indexOf(marker);
    const iWithout = withoutBtn.indexOf(marker);
    expect(iWith).toBeGreaterThan(0);
    expect(iWith).toBe(iWithout);
    // Remove button renders AFTER the value slot (trailing edge).
    const btnIdx = withBtn.indexOf("aria-label=");
    expect(btnIdx).toBeGreaterThan(iWith);
    // And the button no longer sits between label and value.
    expect(withBtn.indexOf(btnIdx >= 0 ? "aria-label" : "")).toBeGreaterThan(
      iWith,
    );
  });
});
