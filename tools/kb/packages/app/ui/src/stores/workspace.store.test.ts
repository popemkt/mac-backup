/**
 * The workspace's arrangement and focus: per device, the URL naming the
 * focused pane, and "Save workspace" writing a layout node through the one
 * check a proposed view goes through (`view.propose`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LayoutView, layoutPanes, type LayoutTree } from "@kb/views";
import { installDomGlobals, type InstalledDom } from "@/test-support/dom-globals";

const invoke = vi.fn();
vi.mock("@/session/runtime", () => ({ invoke: (id: string, input: unknown) => invoke(id, input) }));

const { getPath, navigate } = await import("@/lib/router");
const { startWorkspace, useWorkspaceStore, WORKSPACE_STORAGE_KEY } =
  await import("@/stores/workspace.store");
const { useOutlineStore } = await import("@/stores/outline.store");

const paths = () => layoutPanes(useWorkspaceStore.getState().layout).map((pane) => pane.path);

describe("the workspace", () => {
  let dom: InstalledDom;
  let stop: () => void;

  beforeEach(() => {
    dom = installDomGlobals();
    window.history.pushState({}, "", "/");
    useWorkspaceStore.setState({ layout: { tabs: [{ id: "main", path: "/" }] }, focused: "main" });
    stop = startWorkspace();
    invoke.mockReset();
  });

  afterEach(() => {
    stop();
    dom.restore();
  });

  it("opens beside the pane asked, focuses it and names it in the URL", () => {
    const id = useWorkspaceStore.getState().openBeside("main", "/node/n.a");
    expect(id).toBe("p2");
    expect(useWorkspaceStore.getState().focused).toBe("p2");
    expect(getPath()).toBe("/node/n.a");
    expect(JSON.parse(window.localStorage.getItem(WORKSPACE_STORAGE_KEY) ?? "{}")).toMatchObject({
      focused: "p2",
    });
  });

  it("moves the focused pane by the URL, and another pane without touching it", () => {
    useWorkspaceStore.getState().openBeside("main", "/node/n.a");
    navigate("/graph");
    expect(paths()).toEqual(["/", "/graph"]);
    useWorkspaceStore.getState().navigatePane("main", "/canvas");
    expect(paths()).toEqual(["/canvas", "/graph"]);
    expect(getPath()).toBe("/graph");
  });

  it("closing the focused pane focuses its neighbour, and the last pane stays", () => {
    useWorkspaceStore.getState().openBeside("main", "/node/n.a");
    useWorkspaceStore.getState().close("p2");
    expect(useWorkspaceStore.getState().focused).toBe("main");
    expect(getPath()).toBe("/");
    useWorkspaceStore.getState().close("main");
    expect(paths()).toEqual(["/"]);
  });

  it("replaces the arrangement with a saved layout, focusing its first pane", () => {
    const saved: LayoutTree = {
      split: "column",
      children: [{ tabs: [{ id: "x", path: "/graph" }] }, { tabs: [{ id: "y", path: "/canvas" }] }],
    };
    useWorkspaceStore.getState().replace(saved);
    expect(useWorkspaceStore.getState().layout).toEqual(saved);
    expect(useWorkspaceStore.getState().focused).toBe("x");
    expect(getPath()).toBe("/graph");
  });

  it("saves the arrangement as a layout node through view.propose, the zoom kept as its node", async () => {
    useOutlineStore.setState({ rootNodeId: "n.zoomed" });
    useWorkspaceStore.getState().openBeside("main", "/graph");
    invoke.mockResolvedValue({
      status: "succeeded",
      id: "view.propose",
      output: { id: "v.saved" },
    });
    await expect(useWorkspaceStore.getState().save("Morning")).resolves.toBe("v.saved");
    expect(invoke).toHaveBeenCalledWith("view.propose", {
      view: LayoutView.id,
      text: "Morning",
      params: {
        root: {
          split: "row",
          children: [
            { tabs: [{ id: "main", path: "/node/n.zoomed" }] },
            { tabs: [{ id: "p2", path: "/graph" }] },
          ],
        },
      },
    });
  });

  it("says why a save was refused, and saves nothing", async () => {
    invoke.mockResolvedValue({
      status: "failed",
      id: "view.propose",
      code: "invalid_input",
      message: "nope",
    });
    await expect(useWorkspaceStore.getState().save("Broken")).resolves.toBeNull();
  });
});
