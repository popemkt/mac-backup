/**
 * "Make default view" (DESIGN.md → View nodes): offered on a host for each
 * view it names after its default, and on a view node for each host that
 * names it after another; running it moves the view first in that host's
 * `sys.f.views` and touches no other host.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SYSTEM_IDS, defaultViewIdOf, hostViewIds, present, viewOptionId } from "@kb/model";
import type { WireNode } from "@kb/contracts";
import { fixtureGraph } from "@/api/fixture-graph";
import { useDebugFieldsStore } from "@/stores/debug-fields.store";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { useOutlineStore } from "@/stores/outline.store";
import { usePrefsStore } from "@/stores/prefs.store";
import { useUiStore } from "@/stores/ui.store";
import { installDomGlobals } from "@/test-support/dom-globals";
import { resetOutlineStore } from "@/test-support/outline-store";
import {
  commandTargetNodeId,
  listNodeCommands,
  runCommand,
  viewTargetFrameId,
} from "@/lib/commands";
import type { CommandContext } from "@kb/ui-sdk";
import { bundledSeed } from "@kb/bundled";

const AT = "2026-09-30T00:00:00.000Z";

function wire(id: string, text: string, props: WireNode["props"]): WireNode {
  return { id, text, props, children: [], createdAt: AT, updatedAt: AT };
}

const ref = (v: string) => ({ t: "ref" as const, v });

function graph(): WireNode[] {
  const seeded: WireNode[] = bundledSeed().map((n) => ({ ...n }));
  const seededIds = new Set(seeded.map((n) => n.id));
  const names = { [SYSTEM_IDS.viewsField]: [ref("v.table"), ref("v.board")] };
  return [
    ...seeded,
    ...structuredClone(fixtureGraph.nodes).filter((n) => !seededIds.has(n.id)),
    wire("v.table", "", { [SYSTEM_IDS.viewField]: [ref(viewOptionId("outline.table"))] }),
    wire("v.board", "Board view", { [SYSTEM_IDS.viewField]: [ref(viewOptionId("outline.board"))] }),
    wire("h.page", "Page", names),
    wire("h.other", "Other", names),
  ];
}

function context(): CommandContext {
  const outline = useOutlineStore.getState();
  return {
    target: { nodeId: commandTargetNodeId(outline), frameId: viewTargetFrameId(outline) },
    outline,
    prefs: usePrefsStore.getState(),
    ui: useUiStore.getState(),
    debugFields: useDebugFieldsStore.getState(),
    workspace: useWorkspaceStore.getState(),
    palette: { close: () => {}, openStep: () => {} },
  };
}

/** The "Make default view" rows the node menu offers for `nodeId`. */
function offered(nodeId: string) {
  useOutlineStore.setState({ selectedNodeId: nodeId });
  return listNodeCommands(context()).filter((c) => c.id.startsWith("make-default-view:"));
}

const defaultOf = (id: string) => defaultViewIdOf(useOutlineStore.getState().nodes.get(id));

describe("Make default view", () => {
  const dom = { restore: () => {} };
  beforeAll(() => {
    dom.restore = installDomGlobals().restore;
  });
  afterAll(() => dom.restore());
  beforeEach(() => {
    resetOutlineStore();
    useOutlineStore.getState().hydrateFromWire(graph(), fixtureGraph.rev, "fixtures");
  });

  it("on a host, offers each view after its default, named by text or by its view", async () => {
    const rows = offered("h.page");
    expect(rows.map((c) => c.label)).toEqual(["Make default view: Board view"]);
    await runCommand(present(rows[0], "a row").id, context());
    expect(defaultOf("h.page")).toBe("v.board");
    expect(hostViewIds(useOutlineStore.getState().nodes.get("h.page"))).toEqual([
      "v.board",
      "v.table",
    ]);
    expect(defaultOf("h.other")).toBe("v.table");
    expect(offered("h.page").map((c) => c.label)).toEqual(["Make default view: Table"]);
  });

  it("on a view node, offers each host that names it after another", async () => {
    expect(offered("v.table")).toEqual([]);
    const rows = offered("v.board");
    expect(rows.map((c) => c.label)).toEqual([
      "Make default view of Page",
      "Make default view of Other",
    ]);
    await runCommand(present(rows[1], "a row").id, context());
    expect(defaultOf("h.other")).toBe("v.board");
    expect(defaultOf("h.page")).toBe("v.table");
  });
});
