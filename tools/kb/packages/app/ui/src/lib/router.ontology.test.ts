import { describe, expect, it } from "vitest";
import { matchRoute, ontologyPath } from "@/lib/router";

describe("ontology routes", () => {
  it("matches the list route", () => {
    expect(matchRoute("/o")).toEqual({ name: "ontology-list" });
    expect(matchRoute("/o/")).toEqual({ name: "ontology-list" });
  });

  it("matches the page, outline, and graph views", () => {
    expect(matchRoute("/o/abc")).toEqual({
      name: "ontology",
      id: "abc",
      view: "page",
    });
    expect(matchRoute("/o/abc/")).toEqual({
      name: "ontology",
      id: "abc",
      view: "page",
    });
    expect(matchRoute("/o/abc/outline")).toEqual({
      name: "ontology",
      id: "abc",
      view: "outline",
    });
    expect(matchRoute("/o/abc/graph")).toEqual({
      name: "ontology",
      id: "abc",
      view: "graph",
    });
  });

  it("decodes the id", () => {
    expect(matchRoute("/o/a%2Fb")).toEqual({
      name: "ontology",
      id: "a/b",
      view: "page",
    });
  });

  it("falls back to the outline for unknown sub-views and deeper paths", () => {
    expect(matchRoute("/o/abc/schema")).toEqual({ name: "outline" });
    expect(matchRoute("/o/abc/graph/extra")).toEqual({ name: "outline" });
  });

  it("does not shadow existing routes", () => {
    expect(matchRoute("/").name).toBe("outline");
    expect(matchRoute("/canvas").name).toBe("canvas-list");
    expect(matchRoute("/graph").name).toBe("graph");
    expect(matchRoute("/other").name).toBe("outline");
  });

  it("round-trips through ontologyPath", () => {
    for (const view of ["page", "outline", "graph"] as const) {
      const path = ontologyPath("a b", view);
      const route = matchRoute(path);
      expect(route).toEqual({ name: "ontology", id: "a b", view });
    }
  });
});
