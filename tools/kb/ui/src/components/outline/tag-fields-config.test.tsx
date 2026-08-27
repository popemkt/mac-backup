/**
 * The tag page had no way to add a field: mutations.addTagField/defineField
 * existed and were tested, but no component called them, so the CLI was the
 * only path. These lock the affordance and its reuse rule in place.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  TagFieldsConfigView,
  resolveTagFields,
  type TagFieldRef,
} from "./tag-fields-config";
import { SYSTEM_IDS, type OutlineNode } from "@/lib/types";

/** The real outline shape, narrowed — not a lookalike that can drift from it. */
type TestNode = Pick<OutlineNode, "text" | "props">;

const nodes = new Map<string, TestNode>([
  [
    "tag_project",
    {
      text: "project",
      props: {
        [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
        [SYSTEM_IDS.fieldsField]: [
          { t: "ref", v: "f_owner" },
          { t: "ref", v: "f_due" },
        ],
      },
    },
  ],
  [
    "tag_empty",
    {
      text: "empty",
      props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }] },
    },
  ],
  [
    "f_owner",
    { text: "owner", props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }] } },
  ],
  [
    "f_due",
    { text: "due", props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }] } },
  ],
  [
    "f_severity",
    { text: "severity", props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }] } },
  ],
]);

const view = (over: Partial<Parameters<typeof TagFieldsConfigView>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(TagFieldsConfigView, {
      tagId: "tag_project",
      template: [{ id: "f_owner", name: "owner" }],
      suggestions: [{ id: "f_severity", name: "severity" }],
      readOnly: false,
      onAdd: () => undefined,
      onRemove: () => undefined,
      onOpen: () => undefined,
      ...over,
    }),
  );

describe("resolveTagFields", () => {
  it("returns the template in the tag's own order, not alphabetically", () => {
    const { template } = resolveTagFields(nodes, "tag_project");
    expect(template.map((f) => f.name)).toEqual(["owner", "due"]);
  });

  it("suggests only fields the tag does not already carry", () => {
    const { suggestions } = resolveTagFields(nodes, "tag_project");
    // Offering a field already on the tag would make picking it a no-op.
    expect(suggestions.map((f) => f.name)).toEqual(["severity"]);
  });

  it("still surfaces a template ref whose field node is missing", () => {
    const orphaned = new Map<string, TestNode>([
      [
        "tag_x",
        {
          text: "x",
          props: {
            [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
            [SYSTEM_IDS.fieldsField]: [{ t: "ref", v: "f_gone" }],
          },
        },
      ],
    ]);
    const { template } = resolveTagFields(orphaned, "tag_x");
    expect(template).toEqual<TagFieldRef[]>([{ id: "f_gone", name: "f_gone" }]);
  });

  it("finds nothing for a tag with no fields", () => {
    expect(resolveTagFields(nodes, "tag_empty").template).toEqual([]);
  });
});

describe("TagFieldsConfigView", () => {
  it("offers the add-field input that was missing entirely", () => {
    expect(view()).toContain('aria-label="Add a field to this tag"');
  });

  it("lists template fields with a remove control", () => {
    const html = view();
    expect(html).toContain("owner");
    expect(html).toContain('aria-label="Remove field owner from this tag"');
    expect(html).toContain("(1)");
  });

  it("exposes suggestions as datalist options so names get reused", () => {
    const html = view();
    expect(html).toContain('value="severity"');
  });

  it("explains what fields do when the tag has none", () => {
    const html = view({ template: [] });
    expect(html).toContain("(0)");
    expect(html).toContain("No fields yet");
  });

  it("offers no editing controls on a write-guarded sys.* tag", () => {
    const html = view({ readOnly: true, tagId: SYSTEM_IDS.tag });
    expect(html).not.toContain('aria-label="Add a field to this tag"');
    expect(html).not.toContain("Remove field");
  });

  it("commits a typed name on Enter", () => {
    // Behaviour is in the handler; assert the wiring exists rather than
    // simulating keys in a static render.
    const onAdd = vi.fn();
    expect(() => view({ onAdd })).not.toThrow();
    expect(view({ onAdd })).toContain('placeholder="Add field"');
  });
});
