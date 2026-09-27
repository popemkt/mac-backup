/**
 * i10 item 4 — color swatch field editor for sys.f.color on tag node pages.
 */
import type { KbIndex } from "@/ds";
import { fieldContextOf, type FieldContext } from "@/lib/schema";
import { describe, expect, it } from "vitest";
import { fieldTypeOf, systemSeedNodes } from "@kb/model";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ColorSwatchEditor } from "./field-value";
import { ValueSlot } from "./value-slot";
import { SYSTEM_IDS, type NodeMap } from "@/lib/types";
import { TAG_PALETTE } from "@/lib/tag-color";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The one constructor, over an unscoped graph: the whole map is the schema. */
function contextFor(nodes: NodeMap, index: KbIndex | null = null): FieldContext {
  return fieldContextOf({ ontologyId: null, nodes, wireNodes: [], index });
}

const outlineDir = path.dirname(fileURLToPath(import.meta.url));
const nodes: NodeMap = new Map();

describe("ColorSwatchEditor (i10 item 4)", () => {
  it("renders palette swatches and custom hex input", () => {
    const html = renderToStaticMarkup(
      createElement(ColorSwatchEditor, {
        value: TAG_PALETTE[0],
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

  it("ValueSlot routes sys.f.color to the swatch editor", () => {
    const html = renderToStaticMarkup(
      createElement(ValueSlot, {
        value: { t: "str", v: "#3b82f6" },
        display: "#3b82f6",
        fieldType: "text",
        fieldId: SYSTEM_IDS.colorField,
        context: contextFor(nodes),
        onCommit: () => undefined,
        onFollow: () => undefined,
      }),
    );
    expect(html).toContain('data-color-swatch-editor="true"');
    expect(html).not.toContain("empty-placeholder");
  });

  it("no bespoke TagConfigPanel — configure via node fields", () => {
    expect(() => readFileSync(path.join(outlineDir, "tag-config-panel.tsx"), "utf8")).toThrow();
    const fields = readFileSync(path.join(outlineDir, "fields-section.tsx"), "utf8");
    expect(fields).toContain("fieldId={p.fieldId}");
    // The hidden flag is a checkbox because its seeded field node says so,
    // not because the field section special-cases its id.
    expect(fields).not.toContain("SYSTEM_IDS.hiddenField");
    const hidden = systemSeedNodes().find((n) => n.id === SYSTEM_IDS.hiddenField);
    expect(fieldTypeOf(hidden?.props)).toBe("checkbox");
  });
});
