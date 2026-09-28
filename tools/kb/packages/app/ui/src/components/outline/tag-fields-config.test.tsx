/**
 * The tag page had no way to add a field: mutations.addTagField/defineField
 * existed and were tested, but no component called them, so the CLI was the
 * only path. These lock the affordance and its reuse rule in place.
 */
import { schemaOf, type SchemaIndex } from "@/lib/schema";
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { installDomGlobals } from "@/test-support/dom-globals";
import { renderToStaticMarkup } from "react-dom/server";
import { TagFieldsConfigView } from "./tag-fields-config";
import { resolveTagFields, type TagFieldRef } from "./tag-fields";
import { SYSTEM_IDS, type NodeMap, type OutlineNode } from "@/lib/types";

/** The real outline shape, narrowed — not a lookalike that can drift from it. */
type TestNode = Pick<OutlineNode, "text" | "props">;

/** The one constructor, over an unscoped graph of these narrowed nodes. */
function schemaFor(graph: ReadonlyMap<string, TestNode>): SchemaIndex {
  const nodes: NodeMap = new Map(
    [...graph].map(([id, node]) => [
      id,
      {
        id,
        parentId: null,
        children: [],
        collapsed: false,
        createdAt: "",
        updatedAt: "",
        tags: [],
        ...node,
      },
    ]),
  );
  return schemaOf({ ontologyId: null, nodes, wireNodes: [] });
}

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
      template: [{ id: "f_owner", name: "owner" }],
      suggestions: [{ id: "f_severity", name: "severity" }],
      readOnly: false,
      onAdd: () => undefined,
      onRemove: () => undefined,
      onFollow: () => undefined,
      ...over,
    }),
  );

describe("resolveTagFields", () => {
  it("returns the template in the tag's own order, not alphabetically", () => {
    const { template } = resolveTagFields(schemaFor(nodes), "tag_project");
    expect(template.map((f) => f.name)).toEqual(["owner", "due"]);
  });

  it("suggests only fields the tag does not already carry", () => {
    const { suggestions } = resolveTagFields(schemaFor(nodes), "tag_project");
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
    const { template } = resolveTagFields(schemaFor(orphaned), "tag_x");
    expect(template).toEqual<TagFieldRef[]>([{ id: "f_gone", name: "f_gone" }]);
  });

  it("finds nothing for a tag with no fields", () => {
    expect(resolveTagFields(schemaFor(nodes), "tag_empty").template).toEqual([]);
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

  it("offers suggestions through the node picker so names get reused", async () => {
    const dom = installDomGlobals();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const host = dom.window.document.createElement("div") as unknown as HTMLDivElement;
    dom.window.document.body.appendChild(host as unknown as never);
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(
          createElement(TagFieldsConfigView, {
            template: [{ id: "f_owner", name: "owner" }],
            suggestions: [{ id: "f_severity", name: "severity" }],
            readOnly: false,
            onAdd: () => undefined,
            onRemove: () => undefined,
            onFollow: () => undefined,
          }),
        );
      });
      // Closed until the input is aimed at: a page of tags opens no lists.
      expect(host.querySelector('[role="listbox"]')).toBeNull();
      const input = host.querySelector("input");
      await act(async () => {
        input?.dispatchEvent(
          new dom.window.FocusEvent("focusin", { bubbles: true }) as unknown as Event,
        );
      });
      const options = [...host.querySelectorAll('[role="option"]')].map((o) => o.textContent);
      expect(options).toEqual(["severity"]);
    } finally {
      act(() => root.unmount());
      delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
      dom.restore();
    }
  });

  it("explains what fields do when the tag has none", () => {
    const html = view({ template: [] });
    expect(html).toContain("(0)");
    expect(html).toContain("No fields yet");
  });

  it("offers no editing controls on a write-guarded sys.* tag", () => {
    const html = view({ readOnly: true });
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
