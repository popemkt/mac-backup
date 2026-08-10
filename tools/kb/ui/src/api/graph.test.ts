import { afterEach, describe, expect, it } from "vitest";
import { fixtureGraph } from "@/fixtures/graph";
import {
  fetchGraphSnapshot,
  loadGraph,
  setFetchGraphSnapshot,
} from "@/api/graph";

const origFetch = globalThis.fetch;

describe("graph load vs strict resync", () => {
  afterEach(() => {
    globalThis.fetch = origFetch;
    setFetchGraphSnapshot(null);
  });

  it("loadGraph falls back to fixtures on network failure (cold boot only)", async () => {
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as typeof fetch;

    const result = await loadGraph();
    expect(result.source).toBe("fixtures");
    expect(result.snapshot.nodes.length).toBeGreaterThan(0);
  });

  it("fetchGraphSnapshot throws and never returns fixtures on failure", async () => {
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as typeof fetch;

    await expect(fetchGraphSnapshot()).rejects.toThrow(/offline|GET \/api\/graph/);
  });

  it("fetchGraphSnapshot returns parsed api snapshot when ok", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(fixtureGraph), {
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    const snap = await fetchGraphSnapshot();
    expect(snap.rev).toBe(fixtureGraph.rev);
    expect(snap.nodes.some((n) => n.id === "n.root-a")).toBe(true);
  });
});
