/**
 * A renderer embedded through `graph.neighbourhood` draws the neighbourhood of
 * the node it is shown for — not the whole graph, and not "nothing to draw"
 * for want of a graph page around it.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Result } from "effect";
import type { WireNode } from "@kb/contracts";
import { SYSTEM_IDS } from "@kb/model";
import { lensReport, syncUiPlugins, ViewSlot } from "@kb/ui-sdk";
import { paramsFromProps, NeighbourhoodView, type NeighbourhoodParams } from "@kb/views";
import { useOutlineStore } from "@/stores/outline.store";
import { resetOutlineStore } from "@/test-support/outline-store";
import type * as GraphAdapters from "./graph-adapters";

vi.mock("sigma", () => ({ default: class {} }));
vi.mock("sigma/rendering", () => ({ EdgeArrowProgram: class {} }));

/** The node ids each drawing of the 2D renderer was handed, in order. */
const drawn = vi.hoisted(() => [] as string[][]);
vi.mock("./graph-adapters", async (importOriginal) => {
  const real = await importOriginal<typeof GraphAdapters>();
  return {
    ...real,
    Force2dAdapter: (props: Parameters<typeof real.Force2dAdapter>[0]) => {
      drawn.push(props.frame.lensGraph.nodes.map((node) => node.id).toSorted());
      return createElement("div", { "data-testid": "force2d-drawn" });
    },
  };
});

import { graphUiPlugin } from "./plugin";
import { bundledSeed } from "@kb/bundled";

const AT = "2026-09-30T00:00:00.000Z";
const node = (id: string, patch: Partial<WireNode> = {}): WireNode => ({
  id,
  text: id,
  props: {},
  children: [],
  createdAt: AT,
  updatedAt: AT,
  ...patch,
});

/** a ─child→ b ─child→ c, and d mentions a: b's one-hop neighbours are a and c. */
const GRAPH: WireNode[] = [
  ...bundledSeed(AT),
  node("n.a", { children: ["n.b"] }),
  node("n.b", { children: ["n.c"] }),
  node("n.c"),
  node("n.d", { text: "see [[n.a]]" }),
];

/** A stored view node naming the neighbourhood, read for `host`. */
function storedFor(host: string, props: WireNode["props"]): NeighbourhoodParams {
  return Result.getOrThrow(
    paramsFromProps(
      NeighbourhoodView,
      { [SYSTEM_IDS.viewField]: [{ t: "ref", v: NeighbourhoodView.option }], ...props },
      host,
      lensReport(),
    ),
  );
}

async function settle(ready: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !ready(); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
  if (!ready()) throw new Error("the neighbourhood never drew");
}

describe("graph.neighbourhood", () => {
  let dom: Window;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    dom = new Window();
    const g = globalThis as Record<string, unknown>;
    g.window = dom;
    g.document = dom.document;
    g.HTMLElement = dom.HTMLElement;
    g.Node = dom.Node;
    g.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    syncUiPlugins([graphUiPlugin]);
  });

  afterAll(() => syncUiPlugins([]));

  beforeEach(() => {
    drawn.length = 0;
    resetOutlineStore();
    useOutlineStore.getState().hydrateFromWire(GRAPH, 1, "fixtures");
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function draw(params: NeighbourhoodParams): Promise<string[]> {
    drawn.length = 0;
    await act(async () =>
      root.render(
        <ViewSlot
          view={NeighbourhoodView}
          params={params}
          placement="inline"
          fallback={<p data-testid="fallback">fallback</p>}
        />,
      ),
    );
    await settle(() => drawn.length > 0);
    return drawn.at(-1) ?? [];
  }

  it("draws the node it is shown for and its neighbours, both ways, one hop out", async () => {
    const params = storedFor("n.b", {
      [SYSTEM_IDS.lensEdgeKindsField]: [{ t: "ref", v: "sys.graph.source.containment" }],
    });
    expect(await draw(params)).toEqual(["n.a", "n.b", "n.c"]);
  });

  it("reaches further with more hops, and along the edges it names", async () => {
    const params = storedFor("n.c", {
      [SYSTEM_IDS.lensHopsField]: [{ t: "num", v: 2 }],
      [SYSTEM_IDS.lensEdgeKindsField]: [
        { t: "ref", v: "sys.graph.source.containment" },
        { t: "ref", v: "sys.graph.source.mentions" },
      ],
    });
    // c ←child b ←child a within two hops; d mentions a, which is three away.
    expect(await draw(params)).toEqual(["n.a", "n.b", "n.c"]);
    const fromA = storedFor("n.a", {
      [SYSTEM_IDS.lensEdgeKindsField]: [{ t: "ref", v: "sys.graph.source.mentions" }],
    });
    expect(await draw(fromA)).toEqual(["n.a", "n.d"]);
  });

  it("draws its focus, not its host, when the view node names one", async () => {
    const params = storedFor("n.d", {
      [SYSTEM_IDS.lensFocusField]: [{ t: "ref", v: "n.c" }],
      [SYSTEM_IDS.lensEdgeKindsField]: [{ t: "ref", v: "sys.graph.source.containment" }],
    });
    expect(params.root).toBe("n.c");
    expect(await draw(params)).toEqual(["n.b", "n.c"]);
  });

  it("names the field when a stored view node cannot be read", () => {
    const decoded = paramsFromProps(
      NeighbourhoodView,
      { [SYSTEM_IDS.lensHopsField]: [{ t: "num", v: 9 }] },
      "n.b",
      lensReport(),
    );
    expect(Result.isFailure(decoded) ? decoded.failure : "").toContain("hops");
    const hostless = paramsFromProps(NeighbourhoodView, {}, null, lensReport());
    expect(Result.isFailure(hostless) ? hostless.failure : "").toContain("root");
  });
});
