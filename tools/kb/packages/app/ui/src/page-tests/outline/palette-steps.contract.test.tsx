/**
 * Every node-palette step a family contributes (`PaletteStepPoint`) holds to
 * one contract: opened, it renders in the palette (its label, placeholder and
 * candidates); picking a row runs its write; and with its family switched
 * off, it is gone, so opening it shows the commands instead. The families
 * load as the app loads them (`BROWSER_EXTENSIONS`), so a new step joins the
 * contract by being contributed. A probe command opens each step by id, as
 * the commands that own steps do.
 *
 * The graph's "Type this reference…" is held here too: offered on a row that
 * mentions a node a relation can be typed to, while `graph.suggest-relations`
 * is on.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { WireNode } from "@kb/contracts";
import { GRAPH_IDS } from "@kb/graph";
import { extensionNodeId, fieldTypeValue, present } from "@kb/model";
import { definePlugin, type Plugin } from "@kb/plugin";
import {
  CommandPoint,
  currentContributions,
  PaletteStepPoint,
  SYSTEM_IDS,
  syncUiPlugins,
} from "@kb/ui-sdk";
import { NodeCommandPalette, useOutlineStore } from "@kb/outline-ui";
import { useGraphStore } from "@/stores/graph.store";
import { resetOutlineStore } from "@/test-support/outline-store";
import { syncPagePlugins } from "@/test-support/page-plugins";
import { BROWSER_EXTENSIONS } from "@/ui-plugins";

const ISO = "2026-10-17T00:00:00.000Z";

function wire(partial: Pick<WireNode, "id" | "text"> & Partial<WireNode>): WireNode {
  return { props: {}, children: [], createdAt: ISO, updatedAt: ISO, ...partial };
}

/** A row mentioning n.b, a ref field that allows it, a tag, and the graph's setting on. */
function graph(suggesting = true): WireNode[] {
  return [
    wire({ id: SYSTEM_IDS.tag, text: "sys.tag" }),
    wire({ id: SYSTEM_IDS.field, text: "sys.field" }),
    wire({ id: "n.a", text: "A mentions [[n.b]]" }),
    wire({ id: "n.b", text: "B" }),
    wire({
      id: "t.topic",
      text: "topic",
      props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }] },
    }),
    wire({
      id: "f.rel",
      text: "relates to",
      props: {
        [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
        [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue("ref")],
      },
    }),
    wire({
      id: extensionNodeId("graph"),
      text: "graph",
      props: { [GRAPH_IDS.suggestRelationsField]: [{ t: "bool", v: suggesting }] },
    }),
  ];
}

/** The step the probe command opens. */
let probed = "";
const PROBE_LABEL = "Open the probed step";
const probePlugin = definePlugin({
  name: "probe",
  apply: (ctx) =>
    ctx.contribute(CommandPoint, {
      id: "open",
      value: {
        id: "probe.open",
        scope: "node",
        chrome: () => ({ label: PROBE_LABEL, icon: null }),
        run: (c) => c.palette.openStep(probed),
      },
    }),
});

const steps = () => currentContributions(PaletteStepPoint);

/** Every family's browser entry, as the app loads them. */
async function familyEntries(): Promise<readonly Plugin[]> {
  const entries = Object.values(BROWSER_EXTENSIONS).flatMap((entry) =>
    entry === null ? [] : [entry],
  );
  return Promise.all(entries.map((entry) => entry.load()));
}

let families: readonly Plugin[] = [];

function load(without?: string): void {
  syncPagePlugins([...families.filter((family) => family.name !== without), probePlugin]);
}

describe("node-palette steps", () => {
  let dom: Window;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(async () => {
    dom = new Window();
    const g = globalThis as Record<string, unknown>;
    g.window = dom;
    g.document = dom.document;
    g.HTMLElement = dom.HTMLElement;
    g.KeyboardEvent = dom.KeyboardEvent;
    g.MouseEvent = dom.MouseEvent;
    g.Node = dom.Node;
    g.CSS = { escape: (s: string) => s };
    g.requestAnimationFrame = (fn: () => void) => {
      fn();
      return 0;
    };
    families = await familyEntries();
  });
  afterAll(() => syncUiPlugins([]));

  beforeEach(() => {
    load();
    resetOutlineStore();
    useGraphStore.getState().hydrateFromWire(graph(), 1, "fixtures");
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    dom.document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  async function open(nodeId = "n.a"): Promise<void> {
    const row = dom.document.createElement("div");
    row.setAttribute("data-node-id", nodeId);
    const inner = dom.document.createElement("div");
    inner.className = "node-row";
    row.appendChild(inner);
    dom.document.body.appendChild(row);
    useOutlineStore.setState({ selectedNodeId: nodeId });
    await act(async () => {
      root.render(<NodeCommandPalette open onClose={() => {}} />);
    });
  }

  const rows = () =>
    [...dom.document.querySelectorAll('[data-palette-list="true"] button')].map(
      (b) => b as unknown as HTMLElement,
    );
  const labels = () => rows().map((b) => b.textContent.trim());
  const dialog = () => dom.document.querySelector('[role="dialog"]');

  async function click(label: string): Promise<void> {
    const row = present(
      rows().find((b) => b.textContent.trim() === label),
      label,
    );
    await act(async () => row.click());
  }

  async function openStep(id: string): Promise<void> {
    probed = id;
    await open();
    await click(PROBE_LABEL);
  }

  it("finds every family's steps, the outline's and the graph's among them", () => {
    const ids = steps().map((step) => step.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "outline.add-tag",
        "outline.add-field",
        "outline.add-ref",
        "graph.type-reference",
      ]),
    );
  });

  it("renders each step: its label, its placeholder and its candidates", async () => {
    for (const { id, value } of steps()) {
      await openStep(id);
      expect([id, dialog()?.getAttribute("aria-label")]).toEqual([id, value.label]);
      const input = dom.document.querySelector('[role="dialog"] input') as unknown as
        | HTMLInputElement
        | undefined;
      expect([id, input?.placeholder]).toEqual([id, value.placeholder]);
      expect([id, rows().length > 0]).toEqual([id, true]);
      act(() => root.unmount());
      root = createRoot(container);
    }
  });

  it("runs each step: picking a row hands its write the row and the pick", async () => {
    for (const { id, value } of steps()) {
      const commit = vi.spyOn(value, "commit").mockResolvedValue();
      await openStep(id);
      const [first] = rows();
      await act(async () => present(first, `${id}'s first row`).click());
      expect([id, commit.mock.calls.length]).toEqual([id, 1]);
      expect(commit.mock.calls[0]?.[0]).toMatchObject({ targetNodeId: "n.a" });
      act(() => root.unmount());
      root = createRoot(container);
    }
  });

  it("drops a family's steps with the family, and opening one shows the commands", async () => {
    const owners = [...new Set(steps().map((step) => step.owner))];
    for (const owner of owners) {
      const own = steps()
        .filter((step) => step.owner === owner)
        .map((step) => step.id);
      load(owner);
      expect([owner, steps().some((step) => own.includes(step.id))]).toEqual([owner, false]);
      for (const id of own) {
        await openStep(id);
        expect([id, dialog()?.getAttribute("aria-label")]).toEqual([id, "Node commands"]);
        act(() => root.unmount());
        root = createRoot(container);
      }
      load();
    }
  });

  it("offers Type this reference… on a row that mentions a node a relation can be typed to", async () => {
    await open("n.a");
    expect(labels()).toContain("Type this reference…");
    await click("Type this reference…");
    expect(labels()).toEqual(["relates to → B"]);
  });

  it("offers it nowhere with no reference to type, the setting off, or the graph off", async () => {
    await open("n.b");
    expect(labels()).not.toContain("Type this reference…");
    act(() => useGraphStore.getState().hydrateFromWire(graph(false), 2, "fixtures"));
    await open("n.a");
    expect(labels()).not.toContain("Type this reference…");
    act(() => useGraphStore.getState().hydrateFromWire(graph(), 3, "fixtures"));
    load("graph");
    await open("n.a");
    expect(labels()).not.toContain("Type this reference…");
  });
});
