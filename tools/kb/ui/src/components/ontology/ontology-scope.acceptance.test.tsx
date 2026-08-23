/**
 * End-to-end acceptance for the ontology core, driven through the real App:
 * enter an ontology, see ONLY member nodes and their internal structure, then
 * leave and confirm non-member nodes render exactly as they did before.
 *
 * Needs a real DOM (store hooks + routing + lazy pages), so it lives beside the
 * other `*.component`-class tests and is excluded from the recursive `bun test`.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GraphSnapshot, WireNode } from "@kb/protocol";
import { setFetchGraphSnapshot } from "@/api/graph";
import { setPostAction } from "@/api/action";
import { App } from "@/components/App";
import { navigate } from "@/lib/router";
import { SYSTEM_IDS } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";

const ISO = "2026-08-23T00:00:00.000Z";

function node(
  id: string,
  text: string,
  props: WireNode["props"] = {},
  children: string[] = [],
): WireNode {
  return { id, text, props, children, createdAt: ISO, updatedAt: ISO };
}

const SVC = "t.service";
const ONTO = "o.infra";

/**
 *  #service: "tailscaled" (children: "caddy" [member], "acl file" [NOT])
 *            "caddy"
 *  pinned:   "tunnel notes"
 *  query:    "old vpn doc"
 *  outside:  "shopping list", "acl file"
 */
function snapshot(): GraphSnapshot {
  return {
    rev: 11,
    nodes: [
      node(SVC, "service", {
        [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
      }),
      node(
        "n.tailscaled",
        "tailscaled",
        { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SVC }] },
        ["n.caddy", "n.acl"],
      ),
      node("n.caddy", "caddy", {
        [SYSTEM_IDS.typeField]: [{ t: "ref", v: SVC }],
      }),
      node("n.acl", "acl file"),
      node("n.notes", "tunnel notes"),
      node("n.oldvpn", "old vpn doc"),
      node("n.shopping", "shopping list"),
      node(ONTO, "Infrastructure", {
        [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.ontologyTag }],
        [SYSTEM_IDS.ontoIncludeField]: [{ t: "ref", v: SVC }],
        [SYSTEM_IDS.ontoMemberField]: [{ t: "ref", v: "n.notes" }],
        [SYSTEM_IDS.ontoQueryField]: [
          {
            t: "str",
            v: '[:find ?id :where [?n :node/text "old vpn doc"] [?n :node/id ?id]]',
          },
        ],
      }),
    ],
  };
}

describe("ontology scope (acceptance)", () => {
  let dom: Window;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    dom = new Window({ url: "http://localhost/" });
    const g = globalThis as Record<string, unknown>;
    g.window = dom as unknown;
    g.document = dom.document as unknown;
    g.HTMLElement = dom.HTMLElement as unknown;
    g.KeyboardEvent = dom.KeyboardEvent as unknown;
    g.MouseEvent = dom.MouseEvent as unknown;
    g.PointerEvent = dom.MouseEvent as unknown;
    g.Node = dom.Node as unknown;
    g.CSS = { escape: (s: string) => s };
    g.IS_REACT_ACT_ENVIRONMENT = true;
    g.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    // Never open a socket from a test; the store is driven directly.
    g.WebSocket = class {
      close(): void {}
      send(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
    };
    setFetchGraphSnapshot(() => Promise.resolve(snapshot()));
    setPostAction(() =>
      Promise.resolve({ status: "succeeded", id: "stub", output: {} }),
    );
  });

  afterAll(() => {
    setFetchGraphSnapshot(null);
    setPostAction(null);
  });

  beforeEach(async () => {
    dom.history.pushState({}, "", "/");
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
    await act(async () => {
      root.render(<App />);
    });
    // Settle the async loadGraph() effect.
    await settle();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  /** Flush pending microtasks (async effects, Suspense commits). */
  async function settle(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
    });
  }

  async function goto(path: string): Promise<void> {
    await act(async () => {
      navigate(path);
    });
    await settle();
  }

  function rowTexts(): string[] {
    return [
      ...container.querySelectorAll("[data-instance-key]"),
    ].map((el) => (el.textContent ?? "").trim());
  }

  it("loads the workspace unscoped, showing member and non-member nodes alike", () => {
    const store = useOutlineStore.getState();
    expect(store.loadSource).toBe("api");
    expect(store.rev).toBe(11);
    expect(store.ontologyId).toBeNull();
    const texts = rowTexts().join("\n");
    expect(texts).toContain("tailscaled");
    expect(texts).toContain("shopping list");
    expect(texts).toContain("old vpn doc");
  });

  it("entering an ontology shows only members and their internal structure", async () => {
    await goto("/o/o.infra/outline");

    const store = useOutlineStore.getState();
    expect(store.ontologyId).toBe(ONTO);
    expect([...store.ontologyMembers!].sort()).toEqual([
      "n.caddy",
      "n.notes",
      "n.oldvpn",
      "n.tailscaled",
    ]);

    // Every rendered row is a member (the ontology itself is the scope root).
    for (const id of store.getVisibleNodes()) {
      expect(store.ontologyMembers!.has(id)).toBe(true);
    }

    const texts = rowTexts().join("\n");
    expect(texts).toContain("tailscaled");
    expect(texts).toContain("tunnel notes");
    expect(texts).toContain("old vpn doc");
    // Non-members are gone — including a member's non-member child.
    expect(texts).not.toContain("shopping list");
    expect(texts).not.toContain("acl file");

    // The scope chip states identity, size, and an exit path.
    const bar = container.querySelector("[data-ontology-scope-bar]");
    expect(bar).not.toBeNull();
    expect(bar!.textContent).toContain("Infrastructure");
    expect(bar!.textContent).toContain("4 members");
    expect(bar!.textContent).toContain("Exit");
  });

  it("keeps a member's internal parent/child link inside the scope", async () => {
    await goto("/o/o.infra/outline");
    const nodes = useOutlineStore.getState().nodes;
    // caddy was tailscaled's child and both are members: the link survives.
    expect(nodes.get("n.tailscaled")!.children).toEqual(["n.caddy"]);
    expect(nodes.get("n.caddy")!.parentId).toBe("n.tailscaled");
    // The non-member child is not merely hidden — it is absent.
    expect(nodes.has("n.acl")).toBe(false);
  });

  it("scopes search and the graph projection to members", async () => {
    await goto("/o/o.infra/outline");
    expect(useOutlineStore.getState().search("shopping")).toEqual([]);
    expect(
      useOutlineStore.getState().search("caddy").map((r) => r.id),
    ).toEqual(["n.caddy"]);

    const { extractLensGraph } = await import("@/lib/graph-lens");
    const s = useOutlineStore.getState();
    const graph = extractLensGraph(
      s.queryDb!,
      s.wireNodes,
      {
        id: "p",
        label: "p",
        query: "",
        renderer: "force2d",
        colorBy: "tag",
        sizeBy: "degree",
        edgeKinds: ["child"],
        maxNodes: 500,
        clusterBy: "none",
        focus: null,
      },
      { restrictTo: s.ontologyMembers! },
    );
    expect(graph.nodes.map((n) => n.id).sort()).toEqual([
      "n.caddy",
      "n.notes",
      "n.oldvpn",
      "n.tailscaled",
    ]);
    // Only the internal edge survives (tailscaled → acl file is dropped).
    expect(graph.edges).toEqual([
      { source: "n.tailscaled", target: "n.caddy", kind: "child", weight: 1 },
    ]);
  });

  it("leaving the ontology renders non-members exactly as before", async () => {
    const before = container.innerHTML;
    const beforeRows = rowTexts();

    await goto("/o/o.infra/outline");
    expect(container.querySelector("[data-ontology-scope-bar]")).not.toBeNull();

    await goto("/");
    expect(useOutlineStore.getState().ontologyId).toBeNull();
    expect(container.querySelector("[data-ontology-scope-bar]")).toBeNull();
    expect(rowTexts()).toEqual(beforeRows);
    expect(container.innerHTML).toBe(before);
  });

  it("renders the ontology page and the ontology list route", async () => {
    // Warm the lazy chunks, then let Suspense commit: the first act() pass
    // renders the fallback, the second the resolved page.
    await import("@/components/ontology/ontology-page");
    await import("@/components/ontology/ontology-list-page");
    await goto("/o/o.infra");
    await settle();
    expect(container.textContent).toContain("include");
    expect(container.textContent).toContain("#service");
    expect(container.textContent).toContain("via #service");
    expect(container.textContent).toContain("pinned");
    expect(container.textContent).toContain("via query");

    await goto("/o");
    await settle();
    expect(useOutlineStore.getState().ontologyId).toBeNull();
    expect(container.textContent).toContain("Ontologies");
    expect(container.textContent).toContain("Infrastructure");
  });
});
