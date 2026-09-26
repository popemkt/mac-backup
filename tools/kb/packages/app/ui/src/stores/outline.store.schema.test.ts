/**
 * Scope decides which content the outline shows; it never decides what the
 * schema means. Under an ontology scope the projection holds members only,
 * and every field and tag lookup reads the whole graph through `schemaOf`.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { WireNode } from "@kb/contracts";
import { cardinalityOf, present } from "@kb/model";
import { resolveAllowedRefIdsCached, resolveFieldTypeById } from "@/lib/field-type";
import { formatPropValue, resolveProps } from "@/lib/graph-view";
import { backlinkRows } from "@/lib/backlinks";
import { rowText } from "@/lib/contextual-ref";
import { schemaOf } from "@/lib/schema";
import { SYSTEM_IDS } from "@/lib/types";
import { useOutlineStore } from "./outline.store";

const ISO = "2026-09-26T00:00:00.000Z";
const TAG = "t.svc";

function node(
  id: string,
  text: string,
  props: WireNode["props"] = {},
  children: string[] = [],
): WireNode {
  return { id, text, props, children, createdAt: ISO, updatedAt: ISO };
}

/**
 *   f.status: a single-valued ref field whose option set is its children
 *   opt.open, opt.done: the options (not members)
 *   n.a #svc, status = opt.done — a member
 *   n.opt #svc — a member whose parent is the (non-member) field f.list
 */
function wire(): WireNode[] {
  return [
    node(TAG, "service", { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }] }),
    node(
      "f.status",
      "status",
      {
        [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
        [SYSTEM_IDS.fieldTypeField]: [{ t: "ref", v: SYSTEM_IDS.ftRef }],
        [SYSTEM_IDS.cardinalityField]: [{ t: "ref", v: SYSTEM_IDS.cardinalityOne }],
      },
      ["opt.open", "opt.done"],
    ),
    node("opt.open", "Open"),
    node("opt.done", "Done"),
    node("f.list", "list", { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }] }, [
      "n.opt",
    ]),
    node("n.a", "alpha", {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: TAG }],
      "f.status": [{ t: "ref", v: "opt.done" }],
    }),
    node("n.opt", "option member", { [SYSTEM_IDS.typeField]: [{ t: "ref", v: TAG }] }),
    node("o.1", "Services", {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.ontologyTag }],
      [SYSTEM_IDS.ontoIncludeField]: [{ t: "ref", v: TAG }],
    }),
  ];
}

describe("schema lookups under an ontology scope", () => {
  beforeEach(() => {
    useOutlineStore.getState().hydrateFromWire(wire(), 1, "fixtures");
    useOutlineStore.getState().setOntologyScope("o.1");
  });

  it("the projection holds members only; the schema holds the whole graph", () => {
    const s = useOutlineStore.getState();
    expect(s.nodes.has("f.status")).toBe(false);
    expect(s.nodes.has(TAG)).toBe(false);
    expect(schemaOf(s).has("f.status")).toBe(true);
    // A schema is one object per snapshot: leaving the scope, or expanding
    // and collapsing, does not make a new one (memos keyed on it survive).
    const scopedSchema = schemaOf(s);
    s.setOntologyScope(null);
    expect(schemaOf(useOutlineStore.getState())).toBe(scopedSchema);
    useOutlineStore.getState().toggleCollapse("n.a");
    expect(schemaOf(useOutlineStore.getState())).toBe(scopedSchema);
  });

  it("an option set, its display and its allowed refs resolve as unscoped", () => {
    const s = useOutlineStore.getState();
    const schema = schemaOf(s);
    const field = schema.get("f.status");
    expect(field?.children).toEqual(["opt.open", "opt.done"]);
    expect(resolveFieldTypeById("f.status", schema)).toBe("ref");
    expect(cardinalityOf(field?.props)).toBe("one");
    expect(formatPropValue({ t: "ref", v: "opt.done" }, schema)).toBe("Done");
    const allowed = resolveAllowedRefIdsCached(
      "f.status",
      field,
      schema,
      s.index,
      s.index?.generation ?? 0,
    );
    expect(allowed === null ? null : [...allowed].toSorted()).toEqual(["opt.done", "opt.open"]);
    // The member's field row is named from the field node, not its raw id.
    const member = present(s.nodes.get("n.a"), "member n.a");
    expect(resolveProps(member, schema).map((p) => p.fieldName)).toEqual(["status"]);
  });

  it("a member's tag chip names its non-member tag", () => {
    const member = present(useOutlineStore.getState().nodes.get("n.a"), "member n.a");
    expect(member.tags.map((t) => [t.id, t.name])).toEqual([[TAG, "service"]]);
  });

  it("zooming to a non-member tag leaves the scope", () => {
    useOutlineStore.getState().zoomTo(TAG);
    const s = useOutlineStore.getState();
    expect(s.ontologyId).toBeNull();
    expect(s.rootNodeId).toBe(TAG);
  });

  it("a member parented by a non-member field hangs off the ontology in the breadcrumbs", () => {
    const s = useOutlineStore.getState();
    expect(s.nodes.get("n.opt")?.parentId).toBe("o.1");
    s.zoomTo("n.opt");
    const crumbs = useOutlineStore.getState().getBreadcrumbs();
    expect(crumbs.map((c) => c.id)).not.toContain("f.list");
  });
});

describe("a contextual reference under a scope", () => {
  it("renders its out-of-scope target's text, not the raw id", () => {
    const graph = [
      ...wire(),
      node("n.far", "far away"),
      node("n.ref", "", {
        [SYSTEM_IDS.typeField]: [{ t: "ref", v: TAG }],
        [SYSTEM_IDS.refTargetField]: [{ t: "ref", v: "n.far" }],
      }),
    ];
    useOutlineStore.getState().hydrateFromWire(graph, 1, "fixtures");
    useOutlineStore.getState().setOntologyScope("o.1");
    const s = useOutlineStore.getState();
    expect(s.nodes.has("n.far")).toBe(false);
    const ref = present(s.nodes.get("n.ref"), "member reference");
    expect(rowText(ref, schemaOf(s))).toBe("far away");
  });
});

describe("a member's backlinks under a scope", () => {
  it("name a non-member contextual referrer by its target's text", () => {
    const graph = [
      ...wire(),
      // Not tagged, so not a member: a reference to the member n.a.
      node("n.pointer", "", { [SYSTEM_IDS.refTargetField]: [{ t: "ref", v: "n.a" }] }),
    ];
    useOutlineStore.getState().hydrateFromWire(graph, 1, "fixtures");
    useOutlineStore.getState().setOntologyScope("o.1");
    const s = useOutlineStore.getState();
    expect(s.nodes.has("n.pointer")).toBe(false);
    const rows = backlinkRows(s.index, schemaOf(s), "n.a");
    expect(rows.find((r) => r.id === "n.pointer")?.text).toBe("alpha");
  });
});

describe("transient prune reads content, not template slots", () => {
  /** A supertag templating a hidden and a visible field, and one root. */
  function graph(): WireNode[] {
    return [
      node("t.task", "task", {
        [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
        [SYSTEM_IDS.fieldsField]: [
          { t: "ref", v: "f.due" },
          { t: "ref", v: "f.secret" },
        ],
      }),
      node("f.due", "due", { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }] }),
      node("f.secret", "secret", {
        [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
        [SYSTEM_IDS.hiddenField]: [{ t: "bool", v: true }],
      }),
      node("n.anchor", "anchor"),
    ];
  }

  function transient(props: WireNode["props"]): string {
    const store = useOutlineStore.getState();
    store.hydrateFromWire(graph(), 1, "fixtures");
    store.applyTx([node("n.new", "", props)], []);
    useOutlineStore.getState().markTransient("n.new");
    useOutlineStore.getState().activateNode("n.new", 0);
    expect(useOutlineStore.getState().activeNodeId).toBe("n.new");
    useOutlineStore.getState().deactivateNode();
    return "n.new";
  }

  it("a blank node tagged with a templating supertag prunes on blur", () => {
    const id = transient({ [SYSTEM_IDS.typeField]: [{ t: "ref", v: "t.task" }] });
    expect(useOutlineStore.getState().nodes.has(id)).toBe(false);
  });

  it("a blank node holding a value in a hidden field is kept", () => {
    const id = transient({
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: "t.task" }],
      "f.secret": [{ t: "str", v: "keep me" }],
    });
    expect(useOutlineStore.getState().nodes.has(id)).toBe(true);
  });
});

describe("an unscoped schema", () => {
  it("is the projection's snapshot, and a collapse does not replace it", () => {
    useOutlineStore.getState().hydrateFromWire(wire(), 1, "fixtures");
    const before = schemaOf(useOutlineStore.getState());
    useOutlineStore.getState().toggleCollapse("n.a");
    const after = useOutlineStore.getState();
    expect(after.nodes).not.toBe(before);
    expect(schemaOf(after)).toBe(before);
  });
});
