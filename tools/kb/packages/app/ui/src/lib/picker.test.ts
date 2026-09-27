import { describe, expect, it } from "vitest";
import { CREATE_ROW_ID, matchCandidate, pickerRows, type PickerCandidate } from "@/lib/picker";

const candidates: PickerCandidate[] = [
  { id: "n.b", label: "Beta release" },
  { id: "n.a", label: "Alpha" },
  { id: "n.c", label: "Gamma alpha" },
  { id: "n.d", label: "Data pipeline" },
];

const ids = (rows: ReturnType<typeof pickerRows>) => rows.map((r) => r.id);

describe("matching a query", () => {
  it("ranks a prefix over a substring over an id over a subsequence", () => {
    expect(matchCandidate("Alpha", "x", "al")?.score).toBe(0);
    expect(matchCandidate("Gamma alpha", "x", "al")?.score).toBe(1);
    expect(matchCandidate("Other", "n.alpha", "alpha")?.score).toBe(2);
    expect(matchCandidate("Data pipeline", "x", "dpl")?.score).toBe(3);
    expect(matchCandidate("Alpha", "x", "zz")).toBeNull();
  });

  it("says where in the label the query landed", () => {
    expect(matchCandidate("Gamma alpha", "x", "alp")?.ranges).toEqual([[6, 9]]);
    // A subsequence is highlighted as the runs it matched.
    expect(matchCandidate("Data pipeline", "x", "dapi")?.ranges).toEqual([
      [0, 2],
      [5, 7],
    ]);
    // An id match has nothing in the label to highlight.
    expect(matchCandidate("Other", "n.alpha", "alpha")?.ranges).toEqual([]);
  });
});

describe("the rows a picker shows", () => {
  it("an empty query keeps the source's order", () => {
    expect(ids(pickerRows(candidates, { query: "" }))).toEqual(["n.b", "n.a", "n.c", "n.d"]);
  });

  it("a query puts better matches first, ties in the source's order", () => {
    expect(ids(pickerRows(candidates, { query: "alpha" }))).toEqual(["n.a", "n.c"]);
  });

  it("limits the item rows", () => {
    expect(ids(pickerRows(candidates, { query: "", limit: 2 }))).toEqual(["n.b", "n.a"]);
  });

  it("marks what is already picked, and keeps it pickable", () => {
    const rows = pickerRows(candidates, { query: "", selected: new Set(["n.a"]) });
    expect(rows.map((r) => r.kind === "item" && r.selected)).toEqual([false, true, false, false]);
  });

  it("offers to create a name nothing is called, last", () => {
    const rows = pickerRows(candidates, { query: " Delta ", canCreate: true });
    expect(rows.at(-1)).toEqual({ kind: "create", id: CREATE_ROW_ID, name: "Delta" });
    // Not for a name a candidate already has, whatever its case.
    const named = pickerRows(candidates, { query: "alpha", canCreate: true });
    expect(named.some((r) => r.kind === "create")).toBe(false);
    // Not for an empty query, and not where minting is not allowed.
    expect(pickerRows(candidates, { query: "", canCreate: true }).at(-1)?.kind).toBe("item");
    expect(pickerRows(candidates, { query: "Delta" })).toEqual([]);
  });
});
