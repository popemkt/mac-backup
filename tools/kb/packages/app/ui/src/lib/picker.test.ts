import { describe, expect, it } from "vitest";
import {
  CREATE_ROW_ID,
  labelRuns,
  matchCandidate,
  orderCandidates,
  pickerRows,
  type PickerCandidate,
} from "@kb/ui-sdk";
import { notePick, recentPicks } from "@/lib/picker-recency";

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
    expect(Math.floor(matchCandidate("Data pipeline", "x", "dpi")?.score ?? 0)).toBe(3);
    expect(matchCandidate("Alpha", "x", "zz")).toBeNull();
  });

  it("takes a subsequence only when it is compact or spells word starts", () => {
    expect(matchCandidate("Binary assets & VCS", "x", "bav")).not.toBeNull();
    // Letters strewn across a long label are not a match.
    expect(matchCandidate("Action failures remain localized", "x", "zara")).toBeNull();
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

describe("the order a picker offers with nothing typed", () => {
  const nodes: PickerCandidate[] = [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
    { id: "c", label: "C" },
    { id: "d", label: "D" },
  ];
  const order = (o: Parameters<typeof orderCandidates>[1]) =>
    orderCandidates(nodes, o).map((c) => c.id);

  it("a declared order wins outright", () => {
    expect(order({ declared: ["c", "a"], recent: ["b"] })).toEqual(["c", "a", "b", "d"]);
  });

  it("otherwise the recently picked first, then the most used, then the source's order", () => {
    expect(
      order({
        recent: ["d"],
        uses: new Map([
          ["c", 5],
          ["b", 2],
        ]),
      }),
    ).toEqual(["d", "c", "b", "a"]);
    expect(order({})).toEqual(["a", "b", "c", "d"]);
  });

  it("a session remembers what was picked, most recent first", () => {
    notePick("f.test", "a");
    notePick("f.test", "b");
    notePick("f.test", "a");
    expect(recentPicks("f.test")).toEqual(["a", "b"]);
    expect(recentPicks("f.other")).toEqual([]);
  });
});

describe("a label's highlight", () => {
  it("splits into matched and unmatched runs", () => {
    expect(
      labelRuns("Data pipeline", [
        [0, 2],
        [5, 7],
      ]),
    ).toEqual([
      { text: "Da", matched: true, from: 0 },
      { text: "ta ", matched: false, from: 2 },
      { text: "pi", matched: true, from: 5 },
      { text: "peline", matched: false, from: 7 },
    ]);
  });
});
