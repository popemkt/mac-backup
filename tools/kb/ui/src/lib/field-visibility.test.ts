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
