import { expect, test } from "bun:test";
import { present } from "../src/present.ts";
import { migrateOrderKeys } from "../src/order.ts";

test("order-key migration is additive and preserves legacy root/child order", () => {
  const nodes = [
    { id: "b", text: "b", props: {}, children: ["z", "a"], createdAt: "", updatedAt: "" },
    { id: "z", text: "z", props: {}, children: [], createdAt: "", updatedAt: "" },
    { id: "a", text: "a", props: {}, children: [], createdAt: "", updatedAt: "" },
    { id: "root-z", text: "root z", props: {}, children: [], createdAt: "", updatedAt: "" },
  ];
  const migrated = migrateOrderKeys(nodes);
  expect(migrated.changed).toBe(true);
  expect(migrated.nodes.map((node) => node.text)).toEqual(nodes.map((node) => node.text));
  const byId = new Map(migrated.nodes.map((node) => [node.id, node]));
  expect(
    ["z", "a"].toSorted((x, y) =>
      present(
        present(byId.get(x), "expected byId.get(x)").order,
        "expected byId.get(x).order",
      ).localeCompare(
        present(present(byId.get(y), "expected byId.get(y)").order, "expected byId.get(y).order"),
      ),
    ),
  ).toEqual(["z", "a"]);
  expect(migrateOrderKeys(migrated.nodes).changed).toBe(false);
});

test("migration never rewrites a stored rank, so reordering survives reopen", () => {
  // The first implementation rebuilt the forest-root group with `.sort()` on
  // the id and overwrote stored ranks, so every openKb silently reverted a
  // root reorder back to id order.
  const nodes = [
    {
      id: "r-a",
      text: "a",
      props: {},
      children: [],
      createdAt: "",
      updatedAt: "",
      order: "5000000000",
    },
    {
      id: "r-b",
      text: "b",
      props: {},
      children: [],
      createdAt: "",
      updatedAt: "",
      order: "1000000000",
    },
  ];
  const migrated = migrateOrderKeys(nodes);
  expect(migrated.changed).toBe(false);
  const byId = new Map(migrated.nodes.map((n) => [n.id, n]));
  // b was deliberately moved above a; that must stand.
  expect(present(byId.get("r-b"), 'expected byId.get("r-b")').order).toBe("1000000000");
  expect(present(byId.get("r-a"), 'expected byId.get("r-a")').order).toBe("5000000000");
});

test("migration fills only the gaps in a partly ranked sibling group", () => {
  const nodes = [
    { id: "p", text: "p", props: {}, children: ["c1", "c2", "c3"], createdAt: "", updatedAt: "" },
    {
      id: "c1",
      text: "c1",
      props: {},
      children: [],
      createdAt: "",
      updatedAt: "",
      order: "1000000000",
    },
    { id: "c2", text: "c2", props: {}, children: [], createdAt: "", updatedAt: "" },
    {
      id: "c3",
      text: "c3",
      props: {},
      children: [],
      createdAt: "",
      updatedAt: "",
      order: "3000000000",
    },
  ];
  const migrated = migrateOrderKeys(nodes);
  expect(migrated.changed).toBe(true);
  const byId = new Map(migrated.nodes.map((n) => [n.id, n]));
  expect(present(byId.get("c1"), 'expected byId.get("c1")').order).toBe("1000000000");
  expect(present(byId.get("c3"), 'expected byId.get("c3")').order).toBe("3000000000");
  // The new rank must land between its neighbours, keeping c1 < c2 < c3.
  const c2 = present(
    present(byId.get("c2"), 'expected byId.get("c2")').order,
    'expected byId.get("c2").order',
  );
  expect(c2 > "1000000000").toBe(true);
  expect(c2 < "3000000000").toBe(true);
  expect(migrateOrderKeys(migrated.nodes).changed).toBe(false);
});
