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

function readIndentOwner(): string {
  return readFileSync(path.join(outlineDir, "../../lib/indent.ts"), "utf8");
}

/** Resolved indent step, read from the token sheet the UI actually ships. */
const INDENT_PX = Number(
  /--kb-indent:\s*(\d+(?:\.\d+)?)px/.exec(
    readFileSync(path.join(outlineDir, "../../tokens.css"), "utf8"),
  )?.[1],
);

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
  it("NodeRow indents by depth × 24px, expressed through the indent token", () => {
    // The geometry is unchanged (24px per depth) — it is now stated once, in
    // the token, and applied as space before the row rather than inside it.
    expect(INDENT_PX).toBe(24);
    for (const depth of [0, 1, 3]) {
      const html = renderNodeRowAtDepth(depth);
      expect(html).toMatch(
        new RegExp(`margin-left:\\s*calc\\(${depth} \\* var\\(--kb-indent\\)\\)`),
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
    // The gutter strip lines up with that hit area from the indent owner.
    expect(readOutlineSource("node-block.tsx")).toMatch(/guideLineStyle\(depth\)/);
    expect(readIndentOwner()).toMatch(/\+ 2px/);
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

/**
 * Indent gutter ownership.
 *
 * The gutter left of a row belongs to the tree guide line — which has its own
 * click strip (collapse) in node-block — not to the row. So indentation is
 * space BEFORE a row, never space inside it. Expressed as padding it lived
 * inside the row's border box, and every box-level decoration painted across
 * the gutter: the field row's hover separators ran to the container's left
 * edge, over the guide lines, and the node row's selection fill / focus ring
 * did the same.
 */
describe("Row decorations start at the indent, not the container edge", () => {
  it("FieldRow hover separators do not span the indent gutter", () => {
    const html = renderToStaticMarkup(
      createElement(FieldRow, {
        depth: 2,
        fieldType: "text",
        label: "status",
        children: createElement("span", null, "doing"),
      }),
    );
    // The separators are a border on the row box itself …
    expect(html).toContain("border-y border-transparent");
    expect(html).toContain("hover:border-foreground/[0.07]");
    // … so the indent has to sit outside that box.
    expect(html).toMatch(/margin-left:\s*calc\(3 \* var\(--kb-indent\)\)/);
    expect(html).not.toMatch(/padding-left/);
  });

  it("NodeRow selection fill and focus ring do not span the indent gutter", () => {
    const html = renderToStaticMarkup(
      createElement(NodeRow, {
        depth: 2,
        nodeId: "n.x",
        isSelected: true,
        onRowClick: () => {},
        bullet: createElement("span", { className: "bullet-container h-6 w-6" }),
        content: createElement("div", { className: "kb-text" }, "text"),
      }),
    );
    expect(html).toContain("bg-primary/5");
    expect(html).toContain("focus-visible:ring-2");
    expect(html).toMatch(/margin-left:\s*calc\(2 \* var\(--kb-indent\)\)/);
    expect(html).not.toMatch(/padding-left/);
  });

  it("every indented surface reads the one indent owner", () => {
    for (const name of [
      "node-row.tsx",
      "field-row.tsx",
      "node-block.tsx",
      "query-results.tsx",
    ]) {
      expect(readOutlineSource(name)).toMatch(/from "@\/lib\/indent"/);
    }
  });
});
