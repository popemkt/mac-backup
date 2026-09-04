/**
 * The value stack is a pure view so it can be asserted without a store —
 * store reads do not survive renderToStaticMarkup (the tag-fields-config
 * lesson), and the thing worth pinning here is layout, not wiring.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FieldValueStack } from "@/components/outline/fields-section";
import type { NodeMap, PropValue } from "@/lib/types";

const nodes = new Map() as NodeMap;

function render(values: PropValue[], readOnly = false) {
  return renderToStaticMarkup(
    createElement(FieldValueStack, {
      nodeId: "n.1",
      fieldId: "field.status",
      fieldType: "text" as const,
      allowedRefIds: null,
      values,
      nodes,
      readOnly,
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

  it("offers per-value removal and another slot once a value exists", () => {
    const html = render([{ t: "str", v: "one" }]);
    expect(html).toContain("Remove this value");
    expect(html).toContain(">value</button>");
  });

  it("read-only fields offer neither removal nor new slots", () => {
    const html = render([{ t: "str", v: "one" }], true);
    expect(html).not.toContain("Remove this value");
    expect(html).not.toContain(">value</button>");
  });
});
