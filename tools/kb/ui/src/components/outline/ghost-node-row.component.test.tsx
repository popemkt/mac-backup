import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mutations } from "@/actions/mutations";
import { fixtureGraph } from "@/fixtures/graph";
import { WORKSPACE_ROOT_ID } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { GhostNodeRow } from "./ghost-node-row";

vi.mock("ulid", () => {
  let seq = 0;
  return {
    ulid: () => {
      seq += 1;
      return `01GHOST${String(seq).padStart(18, "0")}`;
    },
  };
});

function seed() {
  useOutlineStore.setState({
    nodes: new Map(),
    wireNodes: [],
    queryDb: null,
    rev: 0,
    rootNodeId: WORKSPACE_ROOT_ID,
    homeRootId: WORKSPACE_ROOT_ID,
    activeNodeId: null,
    activeInstanceKey: null,
    selectedNodeId: null,
    selectedInstanceKey: null,
    cursorPosition: 0,
    loadSource: null,
    loadError: null,
  });
  useOutlineStore
    .getState()
    .hydrateFromWire(fixtureGraph.nodes, fixtureGraph.rev, "fixtures");
}

function fireKey(el: Element, key: string) {
  el.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    }),
  );
}

describe("GhostNodeRow (component)", () => {
  let dom: Window;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    dom = new Window();
    // happy-dom types are structurally close to lib.dom but not assignable;
    // the runtime objects are what React needs, so bridge via unknown.
    const g = globalThis as Record<string, unknown>;
    g.window = dom as unknown;
    g.document = dom.document as unknown;
    g.HTMLElement = dom.HTMLElement as unknown;
    g.KeyboardEvent = dom.KeyboardEvent as unknown;
  });

  beforeEach(() => {
    seed();
    container = dom.document.createElement(
      "div",
    ) as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);

    const realCreate = mutations.createGhostNode.bind(mutations);
    vi.spyOn(mutations, "createGhostNode").mockImplementation(
      async (parentId, afterSiblingId, text) => {
        await new Promise((r) => setTimeout(r, 25));
        return realCreate(parentId, afterSiblingId, text);
      },
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("buffers fast a,b,c keystrokes into one new node with text abc", async () => {
    const beforeCount = useOutlineStore.getState().wireNodes.length;

    await act(async () => {
      root.render(
        <GhostNodeRow depth={1} parentId="n.root-c" afterSiblingId={null} />,
      );
    });

    const ghost = container.querySelector('[data-ghost-row="true"]');
    expect(ghost).toBeTruthy();
    (ghost as HTMLElement).focus();

    act(() => {
      fireKey(ghost!, "a");
      fireKey(ghost!, "b");
      fireKey(ghost!, "c");
    });

    await act(async () => {
      await vi.waitFor(
        () => {
          expect(useOutlineStore.getState().wireNodes.length).toBe(
            beforeCount + 1,
          );
        },
        { timeout: 500 },
      );
    });

    const created = useOutlineStore
      .getState()
      .wireNodes.filter((n) => n.id.startsWith("01GHOST"));
    expect(created).toHaveLength(1);
    expect(created[0]!.text).toBe("abc");
    expect(useOutlineStore.getState().activeNodeId).toBe(created[0]!.id);
    expect(useOutlineStore.getState().cursorPosition).toBe(3);
  });
});
