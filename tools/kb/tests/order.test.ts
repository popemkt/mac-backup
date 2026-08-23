import { expect, test } from "bun:test";
import { migrateOrderKeys } from "../src/foundation/order.ts";

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
  expect(["z", "a"].sort((x, y) => byId.get(x)!.order!.localeCompare(byId.get(y)!.order!))).toEqual(["z", "a"]);
  expect(migrateOrderKeys(migrated.nodes).changed).toBe(false);
});
