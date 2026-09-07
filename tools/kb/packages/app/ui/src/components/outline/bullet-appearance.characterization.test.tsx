/**
 * The bullet's appearance, as a matrix.
 *
 * `bullet.test.tsx` already pins the *paint* — how a node's list of tag colors
 * divides across the filled surfaces. What it does not pin is the shape:
 * `Bullet` chose between a supertag glyph, the query icon, the dashed reference
 * ring, a kind glyph and a plain dot with a nested ternary inside its own JSX,
 * and decided halo, count badge, title and aria-label alongside it.
 *
 * These rows are that decision table, including the two precedences the nested
 * ternary encoded by position: a supertag and a query node keep their own shape
 * *even on a reference row*, so the dashed ring is the third question asked,
 * not the first.
 *
 * Written before `bulletAppearance`, unchanged through it.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { stubOutlineNode } from "@/catalog/fixtures";
import { SYSTEM_IDS, type OutlineNode } from "@/lib/types";
import { Bullet } from "./bullet";

function typed(id: string, typeId: string, extra: Partial<OutlineNode> = {}): OutlineNode {
  return stubOutlineNode({
    id,
    text: id,
    props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: typeId }] },
    ...extra,
  });
}

function html(node: OutlineNode, opts: { isRef?: boolean; collapsible?: boolean } = {}): string {
  return renderToStaticMarkup(
    createElement(Bullet, {
      node,
      isRef: opts.isRef ?? false,
      collapsible: opts.collapsible,
      onClick: () => undefined,
    }),
  );
}

describe("one shape per kind", () => {
  it("a plain leaf is a small dot", () => {
    const out = html(stubOutlineNode({ id: "n.a", text: "a" }));
    expect(out).toContain('data-bullet-kind="plain"');
    expect(out).toContain("data-bullet-dot");
    expect(out).toContain("h-[4px] w-[4px]");
  });

  it("a parent's dot is one pixel larger", () => {
    const out = html(stubOutlineNode({ id: "n.a", text: "a", children: ["n.b"] }));
    expect(out).toContain('data-bullet-kind="parent"');
    expect(out).toContain("h-[5px] w-[5px]");
  });

  it("a supertag is a bold #", () => {
    const out = html(typed("tag.x", SYSTEM_IDS.tag));
    expect(out).toContain('data-bullet-kind="tag"');
    expect(out).toContain(">#</span>");
    expect(out).not.toContain("data-bullet-dot");
  });

  it("a query node is the magnifier, and is collapsible with no children", () => {
    const out = html(
      stubOutlineNode({
        id: "n.q",
        text: "q",
        props: { [SYSTEM_IDS.queryField]: [{ t: "str", v: "[:find ?e]" }] },
      }),
    );
    expect(out).toContain('data-bullet-kind="query"');
    expect(out).toContain("data-bullet-query");
    expect(out).toContain("Click to toggle");
  });

  /** The glyph kinds: one row each, so a moved glyph is a failing row. */
  const GLYPHS: ReadonlyArray<readonly [string, string, OutlineNode]> = [
    ["field", "⌗", typed("f.x", SYSTEM_IDS.field)],
    ["command", "⚙", typed("sys.cmd.x", SYSTEM_IDS.command)],
    [
      "canvas",
      "◇",
      stubOutlineNode({ id: "n.c", text: "c", tags: [{ id: "t.c", name: "canvas", color: "" }] }),
    ],
    [
      "ontology",
      "⬡",
      stubOutlineNode({
        id: "n.o",
        text: "o",
        tags: [{ id: "t.o", name: "ontology", color: "" }],
      }),
    ],
    ["media", "▣", stubOutlineNode({ id: "n.m", text: "![](assets/x.png)" })],
  ];

  for (const [kind, glyph, node] of GLYPHS) {
    it(`${kind} renders ${glyph}`, () => {
      const out = html(node);
      expect(out).toContain(`data-bullet-kind="${kind}"`);
      expect(out).toContain(`>${glyph}</span>`);
      expect(out).not.toContain("data-bullet-dot");
    });
  }

  it("a reference row is a dashed ring around the dot", () => {
    const out = html(stubOutlineNode({ id: "n.a", text: "a" }), { isRef: true });
    expect(out).toContain("data-bullet-ref-ring");
    expect(out).toContain("data-bullet-dot");
    expect(out).toContain('data-bullet-ref="true"');
    expect(out).toContain("border-dashed");
  });
});

describe("shape precedence on a reference row", () => {
  it("a supertag keeps its # — the ring is asked about third, not first", () => {
    const out = html(typed("tag.x", SYSTEM_IDS.tag), { isRef: true });
    expect(out).toContain('data-bullet-ref="true"');
    expect(out).toContain(">#</span>");
    expect(out).not.toContain("data-bullet-ref-ring");
  });

  it("a query node keeps its magnifier", () => {
    const out = html(
      stubOutlineNode({
        id: "n.q",
        text: "q",
        props: { [SYSTEM_IDS.queryField]: [{ t: "str", v: "[:find ?e]" }] },
      }),
      { isRef: true },
    );
    expect(out).toContain("data-bullet-query");
    expect(out).not.toContain("data-bullet-ref-ring");
  });

  it("but a glyph kind loses to the ring — the ring is asked first of the two", () => {
    const out = html(typed("f.x", SYSTEM_IDS.field), { isRef: true });
    expect(out).toContain("data-bullet-ref-ring");
    expect(out).not.toContain("⌗</span>");
  });
});

/** A parent row in one of its two collapse states. */
function parent(collapsed: boolean, children: string[]): OutlineNode {
  return stubOutlineNode({ id: "n.p", text: "p", children, collapsed });
}

describe("halo, count and the affordance it promises", () => {
  it("collapsed with children: halo plus the child count", () => {
    const out = html(parent(true, ["a", "b", "c"]));
    expect(out).toContain("data-bullet-halo");
    expect(out).toContain("data-bullet-count");
    expect(out).toContain(">3</span>");
    expect(out).toContain('aria-label="Expand (3 children)"');
  });

  it("expanded with children: neither halo nor count", () => {
    const out = html(parent(false, ["a"]));
    expect(out).not.toContain("data-bullet-halo");
    expect(out).not.toContain("data-bullet-count");
    expect(out).toContain('aria-label="Collapse"');
  });

  it("a collapsed query node haloes with no count", () => {
    const out = html(
      stubOutlineNode({
        id: "n.q",
        text: "q",
        collapsed: true,
        props: { [SYSTEM_IDS.queryField]: [{ t: "str", v: "[:find ?e]" }] },
      }),
    );
    expect(out).toContain("data-bullet-halo");
    expect(out).not.toContain("data-bullet-count");
    expect(out).toContain('aria-label="Expand results"');
  });

  it("a leaf promises only focus, and carries no aria-label", () => {
    const out = html(stubOutlineNode({ id: "n.a", text: "a", collapsed: true }));
    expect(out).toContain('title="Cmd+click to focus"');
    expect(out).not.toContain("aria-label");
    expect(out).not.toContain("data-bullet-halo");
  });

  it("an explicit collapsible=true makes a childless collapsed row halo", () => {
    // NodeBlock passes this: a node whose only expandable content is its fields.
    const out = html(stubOutlineNode({ id: "n.a", text: "a", collapsed: true }), {
      collapsible: true,
    });
    expect(out).toContain("data-bullet-halo");
    expect(out).not.toContain("data-bullet-count");
    expect(out).toContain('aria-label="Expand results"');
  });

  it("an explicit collapsible=false silences a parent's toggle promise", () => {
    const out = html(parent(true, ["a"]), { collapsible: false });
    expect(out).toContain('title="Cmd+click to focus"');
    expect(out).not.toContain("data-bullet-halo");
  });
});

describe("system nodes are dimmed", () => {
  it("a sys.-prefixed id dims the bullet and says so in the DOM", () => {
    const out = html(stubOutlineNode({ id: "sys.field", text: "sys.field" }));
    expect(out).toContain('data-bullet-sys="true"');
    expect(out).toContain("opacity-50");
  });

  it("an ordinary id does neither", () => {
    const out = html(stubOutlineNode({ id: "n.a", text: "a" }));
    expect(out).not.toContain("data-bullet-sys");
    expect(out).not.toContain("opacity-50");
  });
});
