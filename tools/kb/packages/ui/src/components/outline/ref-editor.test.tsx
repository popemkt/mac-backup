/**
 * The ref picker offers what the field declares.
 *
 * `sys.f.fieldType` is an ordinary ref field whose allowed values are the
 * `#field-type` option nodes — and every one of those is `sys.`-prefixed. Both
 * picker layers used to skip `sys.` ids unconditionally, so a declared
 * constraint resolved to the empty set and the field was unfillable from the
 * outliner: `kb field type` was the only way to set a field's type. These pin
 * the precedence (a field's declared targets outrank the hide-infrastructure
 * heuristic, which now applies only to unconstrained search), the ordering
 * (constrain, then limit — not limit, then constrain), and the one-placeholder
 * rule for the ref editing slot.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { WireNode } from "@kb/contracts";
import { FIELD_TYPE_OPTION_IDS, resolveAllowedRefIds } from "@/lib/field-type";
import { wireToOutlineMap } from "@/lib/graph-view";
import { fuzzyNodeCandidates } from "@/lib/refs";
import { SYSTEM_IDS, WORKSPACE_ROOT_ID, type NodeMap } from "@/lib/types";
import { PropValueEditor } from "./field-value";

const ISO = "2026-08-08T00:00:00.000Z";

function wire(
  partial: Pick<WireNode, "id" | "text"> & Partial<WireNode>,
): WireNode {
  return {
    props: {},
    children: [],
    createdAt: ISO,
    updatedAt: ISO,
    ...partial,
  };
}

/** The seeded field-type ontology (src/foundation/seed.ts): tag + option nodes. */
function fieldTypeOntology(): WireNode[] {
  return [
    wire({ id: SYSTEM_IDS.field, text: "sys.field" }),
    wire({ id: SYSTEM_IDS.tag, text: "sys.tag" }),
    wire({
      id: SYSTEM_IDS.fieldTypeTag,
      text: "field-type",
      props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }] },
    }),
    ...Object.entries(FIELD_TYPE_OPTION_IDS).map(([type, id]) =>
      wire({
        id,
        text: type,
        props: {
          [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.fieldTypeTag }],
        },
      }),
    ),
    wire({
      id: SYSTEM_IDS.fieldTypeField,
      text: "fieldType",
      props: {
        [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
        [SYSTEM_IDS.fieldTypeField]: [
          { t: "ref", v: FIELD_TYPE_OPTION_IDS.ref },
        ],
        [SYSTEM_IDS.targetTagField]: [
          { t: "ref", v: SYSTEM_IDS.fieldTypeTag },
        ],
      },
    }),
    // One ordinary node, so "unconstrained search hides sys nodes" stays
    // observable rather than being vacuously true.
    wire({ id: "n.note", text: "a plain note" }),
  ];
}

const OPTION_IDS = Object.values(FIELD_TYPE_OPTION_IDS).slice().sort();

function ontology(): NodeMap {
  return wireToOutlineMap(fieldTypeOntology(), new Set());
}

/**
 * Render the ref editor for an unset slot.
 *
 * `autoOpen` is the slot's provenance, not a test knob: `true` is the slot a
 * user minted with "+ value" (open, focused), `false` is the slot that exists
 * only because the field is unset (closed placeholder). Both are asserted.
 */
function renderRefSlot(
  nodes: NodeMap,
  allowedRefIds: Set<string> | null,
  autoOpen = true,
) {
  return renderToStaticMarkup(
    createElement(PropValueEditor, {
      value: { t: "ref", v: "" },
      display: "",
      fieldType: "ref",
      fieldId: SYSTEM_IDS.fieldTypeField,
      allowedRefIds,
      autoOpen,
      onCommit: () => {},
      nodes,
    }),
  );
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("ref picker candidates (declared targets win)", () => {
  it("resolves declared sys option nodes as the allowed set", () => {
    const nodes = ontology();
    const allowed = resolveAllowedRefIds(
      nodes.get(SYSTEM_IDS.fieldTypeField),
      nodes,
      null,
    );
    // The constraint is data on the field node; it is not display policy, so
    // it must survive verbatim even though every target is sys-prefixed.
    expect(allowed).not.toBeNull();
    expect([...allowed!].sort()).toEqual(OPTION_IDS);
  });

  it("offers the declared targets in the picker for fieldType", () => {
    const nodes = ontology();
    const allowed = resolveAllowedRefIds(
      nodes.get(SYSTEM_IDS.fieldTypeField),
      nodes,
      null,
    );
    const html = renderRefSlot(nodes, allowed);
    expect(html).toContain('role="listbox"');
    for (const id of OPTION_IDS) expect(html).toContain(id);
  });

  it("hides infrastructure nodes only when nothing is declared", () => {
    const nodes = ontology();
    const ids = fuzzyNodeCandidates(nodes, "").map((c) => c.id);
    expect(ids).toEqual(["n.note"]);
    expect(ids).not.toContain(WORKSPACE_ROOT_ID);
  });

  it("takes the declared set as an input, not a post-filter", () => {
    const nodes = ontology();
    const allowed = new Set(OPTION_IDS);
    const ids = fuzzyNodeCandidates(nodes, "", { allowed }).map((c) => c.id);
    expect(ids.slice().sort()).toEqual(OPTION_IDS);
  });

  it("constrains before the limit, so a late-sorting target survives", () => {
    // 20 filler nodes sort ahead of the one allowed target. Filtering the
    // already-limited top 12 dropped it entirely.
    const filler = Array.from({ length: 20 }, (_, i) =>
      wire({ id: `n.aa-${i}`, text: `aa ${String(i).padStart(2, "0")}` }),
    );
    const nodes = wireToOutlineMap(
      [...filler, wire({ id: "n.target", text: "zz target" })],
      new Set(),
    );
    const html = renderRefSlot(nodes, new Set(["n.target"]));
    expect(html).toContain('role="listbox"');
    expect(html).toContain("n.target");
    expect(html).not.toContain("n.aa-00");
  });
});

describe("an unset ref slot opens on focus, not on mount", () => {
  it("renders closed: no input, no dropdown, just the placeholder", () => {
    // `useState(!refId)` made every unset option field on a page mount open,
    // so their dropdowns all rendered at once and their autoFocus inputs fought
    // each other (and outline keyboard navigation) for the caret.
    const nodes = ontology();
    const html = renderRefSlot(nodes, new Set(OPTION_IDS), false);
    expect(html).not.toContain('role="listbox"');
    expect(html).not.toContain("<input");
    expect(html).not.toContain("autofocus");
    expect(html).toContain('data-ref-slot="closed"');
    // Same placeholder mechanism the other closed editors here use.
    expect(html).toContain("empty-placeholder");
    expect(html).toContain('tabindex="0"');
  });

  it("a slot the user minted with \"+ value\" opens focused", () => {
    const nodes = ontology();
    const html = renderRefSlot(nodes, new Set(OPTION_IDS), true);
    expect(html).toContain("autofocus");
    expect(html).toContain('role="listbox"');
    expect(html).not.toContain('data-ref-slot="closed"');
  });
});

describe("ref editing slot placeholder (one mechanism)", () => {
  it("uses the input placeholder only — never a second Empty span", () => {
    // An `<input>` cannot carry the `.empty-placeholder:empty::before` text, so
    // the native attribute is the only mechanism available here; the extra span
    // was a second one showing "Empty" under "Search node…".
    const html = renderRefSlot(new Map() as NodeMap, null);
    expect(count(html, "placeholder=")).toBe(1);
    expect(html).toContain("Search node");
    expect(html).not.toContain("empty-placeholder");
    expect(html).not.toContain("data-empty-placeholder");
  });

  it("keeps a single placeholder once candidates exist", () => {
    const nodes = ontology();
    const html = renderRefSlot(nodes, new Set(OPTION_IDS));
    expect(count(html, "placeholder=")).toBe(1);
    expect(html).not.toContain("data-empty-placeholder");
  });
});
