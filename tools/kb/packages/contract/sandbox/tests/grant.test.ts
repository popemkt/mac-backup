import { describe, expect, test } from "bun:test";
import type { KbNode } from "@kb/model";
import { DEFAULT_GRANT, grantRefusal, withinSubject, type GrantScope } from "../src/index.ts";

function node(id: string, children: string[] = []): KbNode {
  return { id, text: id, props: {}, children, createdAt: "", updatedAt: "" };
}

const NODES = new Map(
  [node("root", ["a", "b"]), node("a", ["a1"]), node("a1"), node("b"), node("outside")].map((n) => [
    n.id,
    n,
  ]),
);

const scope: GrantScope = { subject: "a", node: (id) => NODES.get(id) };

describe("a code's grant", () => {
  test("reads its subject and the nodes under it, and nothing else, by default", () => {
    expect(grantRefusal(DEFAULT_GRANT, scope, "node.get", { id: "a" })).toBeNull();
    expect(grantRefusal(DEFAULT_GRANT, scope, "node.get", { id: "a1" })).toBeNull();
    expect(grantRefusal(DEFAULT_GRANT, scope, "node.get", { id: "root" })).toContain(
      "outside this code's subject",
    );
    expect(grantRefusal(DEFAULT_GRANT, scope, "node.get", { id: "outside" })).not.toBeNull();
    expect(grantRefusal(DEFAULT_GRANT, scope, "node.get", {})).not.toBeNull();
  });

  test("queries the graph only when it reads the graph", () => {
    expect(grantRefusal(DEFAULT_GRANT, scope, "graph.query", { query: "[]" })).toContain(
      "reads the graph",
    );
    const graph = { reads: "graph" as const, actions: [] };
    expect(grantRefusal(graph, scope, "graph.query", { query: "[]" })).toBeNull();
    expect(grantRefusal(graph, scope, "node.get", { id: "outside" })).toBeNull();
  });

  test("reads nothing under reads: none, and nothing of a subject it is shown for none", () => {
    const none = { reads: "none" as const, actions: [] };
    expect(grantRefusal(none, scope, "node.get", { id: "a" })).toContain("reads nothing");
    const unshown: GrantScope = { subject: null, node: scope.node };
    expect(grantRefusal(DEFAULT_GRANT, unshown, "node.get", { id: "a" })).toContain(
      "shown for no node",
    );
  });

  test("calls any other action only when it names it", () => {
    expect(grantRefusal(DEFAULT_GRANT, scope, "node.update", {})).toBe(
      "node.update is not in this code's grant",
    );
    const writes = { reads: "subject" as const, actions: ["node.update"] };
    expect(grantRefusal(writes, scope, "node.update", {})).toBeNull();
    expect(grantRefusal(writes, scope, "node.delete", {})).not.toBeNull();
  });

  test("a subject walk survives a cycle in children", () => {
    const loop = new Map([node("x", ["y"]), node("y", ["x"])].map((n) => [n.id, n]));
    expect(withinSubject({ subject: "x", node: (id) => loop.get(id) }, "z")).toBe(false);
    expect(withinSubject({ subject: "x", node: (id) => loop.get(id) }, "y")).toBe(true);
  });
});
