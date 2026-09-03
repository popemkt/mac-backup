/**
 * i10 item 4 — color swatch field editor for sys.f.color on tag node pages.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ColorSwatchEditor, PropValueEditor } from "./field-value";
import { SYSTEM_IDS, type NodeMap } from "@/lib/types";
import { TAG_PALETTE } from "@/lib/tag-color";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const outlineDir = path.dirname(fileURLToPath(import.meta.url));
const nodes: NodeMap = new Map();

describe("ColorSwatchEditor (i10 item 4)", () => {
  it("renders palette swatches and custom hex input", () => {
    const html = renderToStaticMarkup(
      createElement(ColorSwatchEditor, {
        value: TAG_PALETTE[0]!,
        onCommit: () => undefined,
      }),
    );
    expect(html).toContain('data-color-swatch-editor="true"');
    expect(html).toContain(`aria-label="Set color ${TAG_PALETTE[0]}"`);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="Custom color hex"');
    for (const hex of TAG_PALETTE) {
      expect(html).toContain(hex);
    }
  });

  it("PropValueEditor routes sys.f.color to the swatch editor", () => {
    const html = renderToStaticMarkup(
      createElement(PropValueEditor, {
        value: { t: "str", v: "#3b82f6" },
        display: "#3b82f6",
        fieldType: "text",
        fieldId: SYSTEM_IDS.colorField,
        nodes,
        onCommit: () => undefined,
      }),
    );
    expect(html).toContain('data-color-swatch-editor="true"');
    expect(html).not.toContain("empty-placeholder");
  });

  it("no bespoke TagConfigPanel — configure via node fields", () => {
    expect(() => readFileSync(path.join(outlineDir, "tag-config-panel.tsx"), "utf8")).toThrow();
    const fields = readFileSync(path.join(outlineDir, "fields-section.tsx"), "utf8");
    expect(fields).toContain("fieldId={p.fieldId}");
    expect(fields).toContain("SYSTEM_IDS.hiddenField");
  });
});
