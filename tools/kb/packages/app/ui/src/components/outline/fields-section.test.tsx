/**
 * The value stack is a pure view so it can be asserted without a store —
 * store reads do not survive renderToStaticMarkup (the tag-fields-config
 * lesson), and the thing worth pinning here is layout, not wiring.
 */
import {
  fieldContextOf,
  SYSTEM_IDS,
  type FieldContext,
  type KbIndex,
  type NodeMap,
  type PropValue,
} from "@kb/ui-sdk";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import { FieldValueStack } from "@/components/outline/fields-section";
import { bundledSeed } from "@kb/bundled";

/** The one constructor, over an unscoped graph: the whole map is the schema. */
function contextFor(nodes: NodeMap, index: KbIndex | null = null): FieldContext {
  return fieldContextOf({ ontologyId: null, nodes, wireNodes: [], index });
}

const nodes = new Map() as NodeMap;

function render(values: PropValue[], readOnly = false) {
  return renderToStaticMarkup(
    createElement(FieldValueStack, {
      nodeId: "n.1",
      fieldId: "field.status",
      fieldType: "text" as const,
      values,
      context: contextFor(nodes),
      readOnly,
      onFollow: () => undefined,
    }),
  );
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("field value stack", () => {
  it("stacks every value under a single label slot", () => {
    // The row above owns the label; three values must not reproduce it three
    // times, which is what a FieldRow-per-value did.
    const html = render([
      { t: "str", v: "one" },
      { t: "str", v: "two" },
      { t: "str", v: "three" },
    ]);
    expect(count(html, 'data-field-values="field.status"')).toBe(1);
    expect(count(html, 'data-field-value="true"')).toBe(3);
  });

  it("offers exactly one editable slot when the field is unset", () => {
    const html = render([]);
    expect(count(html, 'data-field-value="true"')).toBe(0);
    // An unset field is editable without any gesture, so a slot is present.
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("data-field-values");
  });

  it("offers per-value removal and, on the last value, an inline add", () => {
    const html = render([
      { t: "str", v: "one" },
      { t: "str", v: "two" },
    ]);
    expect(html).toContain("Remove this value");
    // One "+", in the last value's trailing space — never a line of its own.
    expect(html.match(/data-add-value="true"/g)?.length).toBe(1);
    expect(html.lastIndexOf('data-add-value="true"')).toBeGreaterThan(html.indexOf(">two<"));
  });

  it("draws remove and add as one icon button, in one line-tall slot", () => {
    // They used to be two hand-rolled buttons — a 16px box with a 9px glyph
    // beside a 20px box with a 10px glyph, offset two ways — so the "×" and
    // the "+" sat at different heights and sizes on the same line.
    const html = render([
      { t: "str", v: "one" },
      { t: "str", v: "two" },
    ]);
    // A bare happy-dom window to read the markup: nothing is mounted.
    const doc = new Window().document;
    doc.body.innerHTML = html;
    const last = [...doc.querySelectorAll('[data-field-value="true"]')].at(-1);
    const remove = last?.querySelector('[aria-label="Remove this value"]');
    const add = last?.querySelector('[data-add-value="true"]');
    for (const button of [remove, add]) {
      expect(button?.getAttribute("data-icon-button")).toBe("sm");
      expect(button?.parentElement?.className).toContain("h-6");
      expect(button?.parentElement?.className).toContain("items-center");
    }
    const removeGlyph = remove?.querySelector("svg")?.getAttribute("width");
    expect(removeGlyph).toBeDefined();
    expect(add?.querySelector("svg")?.getAttribute("width")).toBe(removeGlyph);
  });

  it("a single-valued field offers no second slot", () => {
    // `sys.f.lens.link-distance` declares cardinality one in the seed.
    const seeded = new Map(bundledSeed().map((n) => [n.id, n] as const)) as unknown as NodeMap;
    const html = renderToStaticMarkup(
      createElement(FieldValueStack, {
        nodeId: "n.1",
        fieldId: SYSTEM_IDS.lensLinkDistanceField,
        fieldType: "number" as const,
        values: [{ t: "num", v: 96 }],
        context: contextFor(seeded),
        readOnly: false,
        onFollow: () => undefined,
      }),
    );
    expect(html).toContain("Remove this value");
    expect(html).not.toContain('data-add-value="true"');
  });

  it("read-only fields offer neither removal nor new slots", () => {
    const html = render([{ t: "str", v: "one" }], true);
    expect(html).not.toContain("Remove this value");
    expect(html).not.toContain('data-add-value="true"');
  });
});
