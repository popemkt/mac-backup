import { describe, expect, test } from "bun:test";
import type { KbNode } from "@kb/model";
import {
  ROOT_TARGET,
  callTargets,
  grantRefusal,
  withinSubject,
  type CodeGrant,
  type GrantScope,
} from "../src/index.ts";

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

/** Read the subject, call nothing. */
const SUBJECT: CodeGrant = { reads: "subject", actions: [] };

describe("a code's grant", () => {
  test("reads its subject and the nodes under it, and nothing else, under reads: subject", () => {
    expect(grantRefusal(SUBJECT, scope, "node.get", { id: "a" }, undefined)).toBeNull();
    expect(grantRefusal(SUBJECT, scope, "node.get", { id: "a1" }, undefined)).toBeNull();
    expect(grantRefusal(SUBJECT, scope, "node.get", { id: "root" }, undefined)).toContain(
      "outside this code's subject",
    );
    expect(grantRefusal(SUBJECT, scope, "node.get", { id: "outside" }, undefined)).not.toBeNull();
    expect(grantRefusal(SUBJECT, scope, "node.get", {}, undefined)).not.toBeNull();
  });

  test("queries the graph only when it reads the graph", () => {
    expect(grantRefusal(SUBJECT, scope, "graph.query", { query: "[]" }, undefined)).toContain(
      "reads the graph",
    );
    const graph = { reads: "graph" as const, actions: [] };
    expect(grantRefusal(graph, scope, "graph.query", { query: "[]" }, undefined)).toBeNull();
    expect(grantRefusal(graph, scope, "node.get", { id: "outside" }, undefined)).toBeNull();
  });

  test("reads nothing under reads: none, and nothing of a subject it is shown for none", () => {
    const none = { reads: "none" as const, actions: [] };
    expect(grantRefusal(none, scope, "node.get", { id: "a" }, undefined)).toContain(
      "reads nothing",
    );
    const unshown: GrantScope = { subject: null, node: scope.node };
    expect(grantRefusal(SUBJECT, unshown, "node.get", { id: "a" }, undefined)).toContain(
      "shown for no node",
    );
  });

  test("calls any other action only when it names it", () => {
    expect(grantRefusal(SUBJECT, scope, "node.update", {}, ["a"])).toBe(
      "node.update is not in this code's grant",
    );
    const writes = { reads: "subject" as const, actions: ["node.update"] };
    expect(grantRefusal(writes, scope, "node.update", {}, ["a"])).toBeNull();
    expect(grantRefusal(writes, scope, "node.delete", {}, ["a"])).not.toBeNull();
  });

  test("reaches through any action only what its subject holds, whatever it reads", () => {
    const place = { reads: "subject" as const, actions: ["ext.canvas.place"] };
    const graph = { reads: "graph" as const, actions: ["ext.canvas.place"] };
    for (const grant of [place, graph]) {
      expect(grantRefusal(grant, scope, "ext.canvas.place", {}, ["a1"])).toBeNull();
      expect(grantRefusal(grant, scope, "ext.canvas.place", {}, ["a1", "outside"])).toContain(
        "acts on outside, outside this code's subject a",
      );
      expect(grantRefusal(grant, scope, "ext.canvas.place", {}, [ROOT_TARGET])).toContain(
        "the outline's root",
      );
    }
    // An action that declares nothing it acts on, or a call that names none of it, is no code's.
    expect(grantRefusal(place, scope, "ext.canvas.place", {}, undefined)).toContain(
      "declares no node it acts on",
    );
    expect(grantRefusal(place, scope, "ext.canvas.place", {}, [])).toContain("names no node");
    expect(
      grantRefusal(place, { ...scope, subject: null }, "ext.canvas.place", {}, ["a"]),
    ).toContain("runs for no node");
  });

  test("a call's targets are what its action declares: an id, ids, or the root for null", () => {
    expect(callTargets(undefined, { canvasId: "c" })).toBeUndefined();
    expect(callTargets(["canvasId", "propTargetId"], { canvasId: "c" })).toEqual(["c"]);
    expect(callTargets(["subjects"], { subjects: ["a", "b", 3] })).toEqual(["a", "b"]);
    expect(callTargets(["parent"], { parent: null })).toEqual([ROOT_TARGET]);
    expect(callTargets(["id"], "not an object")).toEqual([]);
  });

  test("the graph's reads are a grant that reads the graph's alone", () => {
    expect(grantRefusal(SUBJECT, scope, "graph.search", { text: "x" }, undefined)).toContain(
      "reads the graph",
    );
    const graph = { reads: "graph" as const, actions: [] };
    expect(grantRefusal(graph, scope, "graph.search", { text: "x" }, undefined)).toBeNull();
  });

  test("a subject walk survives a cycle in children", () => {
    const loop = new Map([node("x", ["y"]), node("y", ["x"])].map((n) => [n.id, n]));
    expect(withinSubject({ subject: "x", node: (id) => loop.get(id) }, "z")).toBe(false);
    expect(withinSubject({ subject: "x", node: (id) => loop.get(id) }, "y")).toBe(true);
  });
});
