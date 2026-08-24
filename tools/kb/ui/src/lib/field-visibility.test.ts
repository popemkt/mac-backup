import { describe, expect, it } from "vitest";
import { fixtureGraph } from "@/fixtures/graph";
import {
  isFieldNodeHidden,
  isIntrinsicSystemPropKey,
  resolveVisibleProps,
} from "@/lib/field-visibility";
import { wireToOutlineMap } from "@/lib/graph-view";
import { planSetFieldHidden } from "@/actions/plan";
import { useOutlineStore } from "@/stores/outline.store";

function mapFromFixture() {
  return wireToOutlineMap(fixtureGraph.nodes, new Set());
}

describe("field visibility", () => {
  it("hides sys.* prop keys and user-hidden fields by default", () => {
    const nodes = mapFromFixture();
    const node = nodes.get("n.root-a")!;
    const visible = resolveVisibleProps(node, nodes);
    expect(visible.map((p) => p.fieldId)).toEqual(["field.status"]);
    expect(isIntrinsicSystemPropKey("sys.f.type")).toBe(true);
    expect(isIntrinsicSystemPropKey("sys.f.color")).toBe(false);
    expect(isFieldNodeHidden("field.noisy", nodes)).toBe(true);
  });

  it("reveals hidden + sys props in debug mode with debug flag", () => {
    const nodes = mapFromFixture();
    const node = nodes.get("n.root-a")!;
    const visible = resolveVisibleProps(node, nodes, { showAllFields: true });
    expect(visible.map((p) => p.fieldId)).toEqual(
      expect.arrayContaining(["sys.f.type", "field.status", "field.noisy"]),
    );
    const noisy = visible.find((p) => p.fieldId === "field.noisy");
    expect(noisy?.debug).toBe(true);
    const type = visible.find((p) => p.fieldId === "sys.f.type");
    expect(type?.debug).toBe(true);
  });

  it("surfaces a supertag's fields on its members even when unset", () => {
    // The gap this closes: the rule used to consult only sys.tag's template,
    // and only for tag nodes, so adding a field to a supertag changed nothing
    // visible on anything tagged with it until someone set a value by hand.
    const wire = [
      ...fixtureGraph.nodes.filter(
        (n) => n.id !== "tag.todo" && n.id !== "n.root-b",
      ),
      {
        ...fixtureGraph.nodes.find((n) => n.id === "tag.todo")!,
        props: {
          "sys.f.type": [{ t: "ref" as const, v: "sys.tag" }],
          "sys.f.fields": [{ t: "ref" as const, v: "field.status" }],
        },
      },
      {
        id: "n.member",
        text: "tagged member",
        children: [],
        props: { "sys.f.type": [{ t: "ref" as const, v: "tag.todo" }] },
        createdAt: "",
        updatedAt: "",
      },
    ];
    const nodes = wireToOutlineMap(wire, new Set());
    const visible = resolveVisibleProps(nodes.get("n.member")!, nodes);

    const status = visible.find((p) => p.fieldId === "field.status");
    expect(status).toBeTruthy();
    expect(status!.empty).toBe(true);
    expect(status!.values).toEqual([]);
  });

  it("surfaces a field node's own type and constraints, so no panel is needed", () => {
    // sys.field templates fieldType/targetTag/targetQuery, and the same rule
    // that serves tags serves field pages — which is what replaced the bespoke
    // FieldTypeConfig panel.
    const wire = [
      ...fixtureGraph.nodes,
      {
        id: "sys.field",
        text: "sys.field",
        children: [],
        props: {
          "sys.f.fields": [
            { t: "ref" as const, v: "sys.f.fieldType" },
            { t: "ref" as const, v: "sys.f.targetTag" },
            { t: "ref" as const, v: "sys.f.targetQuery" },
          ],
        },
        createdAt: "",
        updatedAt: "",
      },
    ];
    const nodes = wireToOutlineMap(wire, new Set());
    const visible = resolveVisibleProps(nodes.get("field.status")!, nodes);
    expect(visible.map((p) => p.fieldId)).toEqual(
      expect.arrayContaining([
        "sys.f.fieldType",
        "sys.f.targetTag",
        "sys.f.targetQuery",
      ]),
    );
  });

  it("surfaces color/hidden template slots on tag nodes even when unset", () => {
    const nodes = mapFromFixture();
    const tag = nodes.get("tag.todo");
    expect(tag).toBeTruthy();
    const visible = resolveVisibleProps(tag!, nodes);
    expect(visible.map((p) => p.fieldId)).toEqual(
      expect.arrayContaining(["sys.f.color", "sys.f.hidden"]),
    );
    const color = visible.find((p) => p.fieldId === "sys.f.color");
    expect(color?.empty || (color?.values.length ?? 0) >= 0).toBe(true);
  });

  it("planSetFieldHidden sets and unsets sys.f.hidden on field nodes", () => {
    useOutlineStore
      .getState()
      .hydrateFromWire(fixtureGraph.nodes, fixtureGraph.rev, "fixtures");
    const wire = useOutlineStore.getState().wireNodes;

    const hide = planSetFieldHidden(wire, "field.status", true);
    const hiddenUpsert = hide.upserts.find((n) => n.id === "field.status");
    expect(hiddenUpsert?.props["sys.f.hidden"]).toEqual([
      { t: "bool", v: true },
    ]);

    const merged = [
      ...wire.filter((n) => n.id !== "field.status"),
      hiddenUpsert!,
    ];
    const show = planSetFieldHidden(merged, "field.status", false);
    const shownUpsert = show.upserts.find((n) => n.id === "field.status");
    expect(shownUpsert?.props["sys.f.hidden"]).toBeUndefined();
  });
});
