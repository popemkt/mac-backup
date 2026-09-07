/**
 * Characterization of palette-command routing (closed gap
 * [[01M1MGCRNVNBE5HW27Z83PK67B]]).
 *
 * One case per `sys.command` id: what running it does, and what it toasts when
 * it cannot. The chain becomes a registry lookup, so this is the gate — the
 * assertions must pass unchanged; only `run` below rebinds, because gap
 * [[01M1RXMQPVJKREGDS7D37J1MWN]] moves the state from the runner's own imports
 * to an argument.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SYSTEM_IDS, systemSeedNodes } from "@kb/model";
import type { WireNode } from "@kb/contracts";
import { fixtureGraph } from "@/fixtures/graph";
import { WORKSPACE_ROOT_ID } from "@/lib/types";
import { useDebugFieldsStore } from "@/stores/debug-fields.store";
import { useOutlineStore } from "@/stores/outline.store";
import { usePrefsStore } from "@/stores/prefs.store";
import { useUiStore } from "@/stores/ui.store";
import { installDomGlobals } from "@/test-support/dom-globals";
import { resetOutlineStore } from "@/test-support/outline-store";
import { commandTargetNodeId, runCommand, viewTargetFrameId } from "@/lib/commands";

/**
 * The one line the registry refactor moved: the runner takes its state as an
 * argument now. Every assertion below is unchanged.
 */
async function run(commandId: string): Promise<void> {
  const outline = useOutlineStore.getState();
  await runCommand(commandId, {
    target: { nodeId: commandTargetNodeId(outline), frameId: viewTargetFrameId(outline) },
    outline,
    prefs: usePrefsStore.getState(),
    ui: useUiStore.getState(),
    debugFields: useDebugFieldsStore.getState(),
    palette: { close: () => {}, openStep: () => {} },
  });
}

/** The real `sys.*` seed plus the fixture's outline rows: commands zoom to
 * seeded roots and write seeded fields, so a partial graph would report a
 * routing failure that is really a missing node. */
function seedGraph(): WireNode[] {
  const seeded: WireNode[] = systemSeedNodes().map((n) => ({ ...n }));
  const seededIds = new Set(seeded.map((n) => n.id));
  // The saved-query root is created on demand, not seeded; `zoomTo` refuses an
  // id the node map does not hold, so the row has to be here to be reachable.
  seeded.push({
    id: SYSTEM_IDS.queriesRoot,
    text: "Queries",
    props: {},
    children: [],
    createdAt: "2026-08-08T05:00:00.000Z",
    updatedAt: "2026-08-08T05:00:00.000Z",
  });
  return [...seeded, ...structuredClone(fixtureGraph.nodes).filter((n) => !seededIds.has(n.id))];
}

function toasts(): string[] {
  return useUiStore.getState().toasts.map((t) => t.text);
}

function node(id: string) {
  return useOutlineStore.getState().nodes.get(id);
}

describe("palette command routing (characterization)", () => {
  const dom = { restore: () => {} };

  beforeAll(() => {
    dom.restore = installDomGlobals().restore;
  });

  afterAll(() => {
    dom.restore();
  });

  beforeEach(() => {
    resetOutlineStore();
    useOutlineStore.getState().hydrateFromWire(seedGraph(), fixtureGraph.rev, "fixtures");
    useUiStore.setState({
      toasts: [],
      prefsOpen: false,
      globalPaletteOpen: false,
      filterPopoverFrameId: null,
    });
    useDebugFieldsStore.setState({ ids: new Set() });
    usePrefsStore.setState({ theme: "light", width: "centered" });
    window.history.pushState({}, "", "/");
  });

  it("add-node appends after the selected row", async () => {
    useOutlineStore.setState({ selectedNodeId: "n.root-b" });
    const before = useOutlineStore.getState().wireNodes.length;
    await run(SYSTEM_IDS.cmdAddNode);
    expect(useOutlineStore.getState().wireNodes.length).toBe(before + 1);
  });

  it("add-node with nothing selected mints a root row and jumps to it", async () => {
    const before = useOutlineStore.getState().wireNodes.length;
    await run(SYSTEM_IDS.cmdAddNode);
    const after = useOutlineStore.getState();
    expect(after.wireNodes.length).toBe(before + 1);
    expect(after.selectedNodeId).not.toBeNull();
  });

  it("add-tag mints a supertag and zooms to it", async () => {
    await run(SYSTEM_IDS.cmdAddTag);
    const zoomed = useOutlineStore.getState().rootNodeId;
    expect(zoomed).not.toBe(WORKSPACE_ROOT_ID);
    expect(node(zoomed)?.text).toBe("untitled-tag");
  });

  it("define-field mints a field and zooms to it", async () => {
    await run(SYSTEM_IDS.cmdDefineField);
    const zoomed = useOutlineStore.getState().rootNodeId;
    expect(node(zoomed)?.text).toBe("untitled-field");
  });

  it("go-query zooms to the saved-query root", async () => {
    await run(SYSTEM_IDS.cmdGoQuery);
    expect(useOutlineStore.getState().rootNodeId).toBe(SYSTEM_IDS.queriesRoot);
  });

  it("new-query mints a query node and zooms to it", async () => {
    await run(SYSTEM_IDS.cmdNewQuery);
    const zoomed = useOutlineStore.getState().rootNodeId;
    expect(zoomed).not.toBe(WORKSPACE_ROOT_ID);
    expect(node(zoomed)?.props[SYSTEM_IDS.queryField]).toBeDefined();
  });

  it("new-ontology mints one and navigates to its page", async () => {
    await run(SYSTEM_IDS.cmdNewOntology);
    expect(window.location.pathname.startsWith("/o/")).toBe(true);
  });

  it("enter-ontology with none toasts an invitation", async () => {
    await run(SYSTEM_IDS.cmdEnterOntology);
    expect(toasts()).toEqual(["No ontologies yet — try “New ontology”"]);
    expect(window.location.pathname).toBe("/");
  });

  it("enter-ontology navigates to the one that exists", async () => {
    await run(SYSTEM_IDS.cmdNewOntology);
    const path = window.location.pathname;
    window.history.pushState({}, "", "/");
    await run(SYSTEM_IDS.cmdEnterOntology);
    expect(window.location.pathname).toBe(path);
  });

  it("exit-ontology outside an ontology toasts instead of navigating", async () => {
    await run(SYSTEM_IDS.cmdExitOntology);
    expect(toasts()).toEqual(["Not inside an ontology"]);
  });

  it("exit-ontology inside one returns to the root path", async () => {
    useOutlineStore.setState({ ontologyId: "o.some" });
    window.history.pushState({}, "", "/o/o.some");
    await run(SYSTEM_IDS.cmdExitOntology);
    expect(window.location.pathname).toBe("/");
  });

  it("preferences opens the prefs dialog", async () => {
    await run(SYSTEM_IDS.cmdPreferences);
    expect(useUiStore.getState().prefsOpen).toBe(true);
  });

  it("toggle-theme steps light → dark → system → light", async () => {
    await run(SYSTEM_IDS.cmdToggleTheme);
    expect(usePrefsStore.getState().theme).toBe("dark");
    await run(SYSTEM_IDS.cmdToggleTheme);
    expect(usePrefsStore.getState().theme).toBe("system");
    await run(SYSTEM_IDS.cmdToggleTheme);
    expect(usePrefsStore.getState().theme).toBe("light");
  });

  it("toggle-width flips centered and full", async () => {
    await run(SYSTEM_IDS.cmdToggleWidth);
    expect(usePrefsStore.getState().width).toBe("full");
    await run(SYSTEM_IDS.cmdToggleWidth);
    expect(usePrefsStore.getState().width).toBe("centered");
  });

  it("debug-show-fields toggles the selected row's flag", async () => {
    useOutlineStore.setState({ selectedNodeId: "n.root-b" });
    await run(SYSTEM_IDS.cmdDebugShowFields);
    expect(useDebugFieldsStore.getState().ids.has("n.root-b")).toBe(true);
  });

  it("debug-show-fields prefers the selected row over the zoomed root", async () => {
    useOutlineStore.setState({ selectedNodeId: "n.root-b", rootNodeId: "n.root-a" });
    await run(SYSTEM_IDS.cmdDebugShowFields);
    expect(useDebugFieldsStore.getState().ids.has("n.root-b")).toBe(true);
    expect(useDebugFieldsStore.getState().ids.has("n.root-a")).toBe(false);
  });

  it("debug-show-fields falls back to the zoomed root, and toasts with neither", async () => {
    useOutlineStore.setState({ rootNodeId: "n.root-a" });
    await run(SYSTEM_IDS.cmdDebugShowFields);
    expect(useDebugFieldsStore.getState().ids.has("n.root-a")).toBe(true);

    resetOutlineStore();
    await run(SYSTEM_IDS.cmdDebugShowFields);
    expect(toasts()).toEqual(["select a node first"]);
  });

  it("expand-all and collapse-all move every expandable row in scope", async () => {
    await run(SYSTEM_IDS.cmdExpandAll);
    expect(node("n.root-a")?.collapsed).toBe(false);
    await run(SYSTEM_IDS.cmdCollapseAll);
    expect(node("n.root-a")?.collapsed).toBe(true);
  });

  it("the four view-as commands write the mode onto the zoomed frame", async () => {
    useOutlineStore.setState({ rootNodeId: "n.root-a" });
    for (const [commandId, mode] of [
      [SYSTEM_IDS.cmdViewAsList, "list"],
      [SYSTEM_IDS.cmdViewAsTable, "table"],
      [SYSTEM_IDS.cmdViewAsBoard, "board"],
      [SYSTEM_IDS.cmdViewAsCards, "cards"],
    ] as const) {
      await run(commandId);
      expect(node("n.root-a")?.props[SYSTEM_IDS.viewModeField]).toEqual([{ t: "str", v: mode }]);
    }
  });

  it("view-as falls back to a selected non-sys row", async () => {
    useOutlineStore.setState({ selectedNodeId: "n.root-b" });
    await run(SYSTEM_IDS.cmdViewAsTable);
    expect(node("n.root-b")?.props[SYSTEM_IDS.viewModeField]).toEqual([{ t: "str", v: "table" }]);
  });

  it("view-as with no frame toasts", async () => {
    useOutlineStore.setState({ selectedNodeId: SYSTEM_IDS.tag });
    await run(SYSTEM_IDS.cmdViewAsList);
    expect(toasts()).toEqual(["select a frame first"]);
  });

  it("view-filter opens the popover on the target frame", async () => {
    useOutlineStore.setState({ rootNodeId: "n.root-a" });
    await run(SYSTEM_IDS.cmdViewFilter);
    expect(useUiStore.getState().filterPopoverFrameId).toBe("n.root-a");
  });

  it("view-filter with no frame toasts", async () => {
    await run(SYSTEM_IDS.cmdViewFilter);
    expect(toasts()).toEqual(["select a frame first"]);
    expect(useUiStore.getState().filterPopoverFrameId).toBeNull();
  });

  it("an unknown id toasts rather than failing silently", async () => {
    await run("sys.cmd.nope");
    expect(toasts()).toEqual(["Unknown command: sys.cmd.nope"]);
  });
});
