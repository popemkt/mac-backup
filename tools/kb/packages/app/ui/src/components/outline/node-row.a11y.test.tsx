/**
 * i10 item 5 — NodeRow a11y: role/keyboard for clickable row shells.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NodeRow } from "./node-row";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const outlineDir = path.dirname(fileURLToPath(import.meta.url));

describe("NodeRow a11y (i10 item 5)", () => {
  it("clickable rows expose treeitem + roving tabindex + keyboard handler", () => {
    const html = renderToStaticMarkup(
      createElement(NodeRow, {
        depth: 0,
        nodeId: "n.x",
        isSelected: true,
        onRowClick: () => undefined,
        bullet: createElement("span", null, "•"),
        content: createElement("span", null, "hello"),
      }),
    );
    expect(html).toContain('role="treeitem"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('data-node-row="true"');
    expect(html).toContain("focus-visible:ring-2");
  });

  it("non-interactive rows stay plain divs", () => {
    const html = renderToStaticMarkup(
      createElement(NodeRow, {
        depth: 0,
        bullet: createElement("span", null, "•"),
        content: createElement("span", null, "hello"),
      }),
    );
    expect(html).not.toContain('role="treeitem"');
    expect(html).not.toContain("tabindex");
  });

  it("active row is marked in data, with no border drawn around it", () => {
    // The owner rejected the active-content ring i10 added: editing a node must
    // not draw a box around it. Keyboard focus is still shown by the
    // focus-visible ring on the row itself (asserted above).
    const html = renderToStaticMarkup(
      createElement(NodeRow, {
        depth: 0,
        isActive: true,
        onRowClick: () => undefined,
        bullet: createElement("span", null, "•"),
        content: createElement("span", null, "editing"),
      }),
    );
    expect(html).toContain('data-active="true"');
    expect(html).not.toContain("ring-1 ring-primary/25");
  });

  it("create strips are keyboard-reachable buttons", () => {
    const block = readFileSync(path.join(outlineDir, "node-block.tsx"), "utf8");
    const editor = readFileSync(path.join(outlineDir, "outline-editor.tsx"), "utf8");
    for (const src of [block, editor]) {
      expect(src).toMatch(/data-create-child-zone[\s\S]*role="button"/);
      expect(src).toContain('aria-label="New');
      expect(src).toContain("focus-visible:ring-2");
    }
  });
});
