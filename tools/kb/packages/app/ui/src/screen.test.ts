/**
 * The tab's side of the screen channel: it publishes what it shows — the
 * route, the view the route resolves to, and what the mounted view reports —
 * throttled and only when it changed, and carries out the server's
 * `ui.navigate` / `ui.select` commands. What the server does with either is
 * `packages/app/server/tests/screens.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SCREEN_APPLIED,
  declarationPlugin,
  type ScreenAck,
  type ScreenCommand,
  type ScreenState,
} from "@kb/contracts";
import { coreExtension } from "@kb/operations";
import type { ScreenTab } from "@/api/live";
import { fixtureGraph } from "@/api/fixture-graph";
import { browserHostUiPlugin } from "@/browser-host";
import { canvasUiPlugin } from "@/components/canvas/plugin";
import { layoutUiPlugin } from "@/components/layout/plugin";
import { outlineUiPlugin } from "@/components/outline/plugin";
import { getPath, navigate, syncUiPlugins, type PaneSelect } from "@kb/ui-sdk";
import { SCREEN_PUBLISH_MS, screenPlugin } from "@/screen";
import { useOutlineStore } from "@/stores/outline.store";
import { useScreenStore } from "@/stores/screen.store";
import { startWorkspace, useWorkspaceStore } from "@/stores/workspace.store";
import { layoutPanes, singlePane } from "@kb/views";
import { installDomGlobals, type InstalledDom } from "@/test-support/dom-globals";

function tab(page: () => Window | null = () => window) {
  const published: ScreenState[] = [];
  const ids: string[] = [];
  let attached: ScreenTab | null = null;
  const plugin = screenPlugin({
    page,
    tabId: () => "tab.first",
    publish: (id, state) => {
      ids.push(id);
      published.push(state);
    },
    attach: (next) => {
      attached = next;
    },
  });
  const side = (): ScreenTab => {
    if (attached === null) throw new Error("no screen side attached");
    return attached;
  };
  const carryOut = (command: ScreenCommand): ScreenAck => side().carryOut(command);
  const refused = (id: string): void => side().refused(id);
  return { plugin, published, ids, carryOut, refused, installed: () => attached !== null };
}

function report(select: PaneSelect = () => ({ outcome: "applied" })) {
  useScreenStore.setState({
    panes: {
      main: {
        report: { subject: "n.root-a", focused: "n.root-a", selection: ["n.root-a"] },
        select,
        owner: Symbol("test view"),
      },
    },
  });
}

describe("the tab's screen", () => {
  let dom: InstalledDom;
  let stopWorkspace: () => void;

  beforeEach(() => {
    dom = installDomGlobals();
    vi.useFakeTimers();
    useOutlineStore.getState().hydrateFromWire(structuredClone(fixtureGraph.nodes), 1, "api");
    // One pane at the URL, kept in step with it, as the app boots.
    useWorkspaceStore.setState({
      layout: singlePane({ id: "main", path: getPath() }),
      focused: "main",
    });
    stopWorkspace = startWorkspace();
  });

  afterEach(() => {
    stopWorkspace();
    syncUiPlugins([]);
    useScreenStore.setState({ panes: {} });
    vi.useRealTimers();
    dom.restore();
  });

  it("publishes the route and its view on start, then each change once, throttled", () => {
    const { plugin, published } = tab();
    syncUiPlugins([browserHostUiPlugin, outlineUiPlugin, canvasUiPlugin, plugin]);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      route: "/",
      activePane: "main",
      panes: [{ id: "main", view: { key: "outline.main" }, focused: null, selection: [] }],
    });

    navigate("/canvas");
    navigate("/canvas/n.missing");
    expect(published).toHaveLength(1);
    vi.advanceTimersByTime(SCREEN_PUBLISH_MS);
    expect(published).toHaveLength(2);
    expect(published[1]).toMatchObject({
      route: "/canvas/n.missing",
      panes: [{ view: { key: "canvas.page" } }],
    });

    // Something that changes nothing on screen is not published again.
    window.dispatchEvent(new window.Event("focus"));
    vi.advanceTimersByTime(SCREEN_PUBLISH_MS);
    expect(published).toHaveLength(2);
  });

  it("carries what the open view reports: its subject, focus and selection", () => {
    const { plugin, published } = tab();
    syncUiPlugins([outlineUiPlugin, plugin]);
    report();
    vi.advanceTimersByTime(SCREEN_PUBLISH_MS);
    expect(published.at(-1)?.panes).toEqual([
      {
        id: "main",
        route: "/",
        view: { key: "outline.main", subject: "n.root-a" },
        focused: "n.root-a",
        selection: ["n.root-a"],
      },
    ]);
  });

  it("names no view on a path no view owns", () => {
    navigate("/nowhere");
    const { plugin, published } = tab();
    syncUiPlugins([outlineUiPlugin, plugin]);
    expect(published[0]?.panes[0]?.view).toBeNull();
  });

  it("navigates to a route a view owns, and refuses one no view owns", () => {
    const { plugin, carryOut } = tab();
    syncUiPlugins([browserHostUiPlugin, outlineUiPlugin, canvasUiPlugin, plugin]);
    expect(carryOut({ kind: "navigate", to: { route: "/canvas" } })).toEqual({
      outcome: "applied",
    });
    expect(getPath()).toBe("/canvas");
    expect(carryOut({ kind: "navigate", to: { route: "/nowhere" } })).toEqual({
      outcome: "rejected",
      reason: "no view owns /nowhere",
    });
    expect(getPath()).toBe("/canvas");
  });

  it("opens a node at its node route, in its default view, and refuses one it does not have", () => {
    const { plugin, carryOut } = tab();
    syncUiPlugins([browserHostUiPlugin, outlineUiPlugin, canvasUiPlugin, layoutUiPlugin, plugin]);
    navigate("/canvas");
    expect(carryOut({ kind: "navigate", to: { node: "n.root-a" } })).toEqual({
      outcome: "applied",
    });
    expect(getPath()).toBe("/node/n.root-a");
    expect(carryOut({ kind: "navigate", to: { node: "n.missing" } })).toEqual({
      outcome: "rejected",
      reason: "no node n.missing",
    });
  });

  it("publishes every pane, the focused one active, and carries a command to the pane it names", () => {
    const { plugin, published, carryOut } = tab();
    syncUiPlugins([browserHostUiPlugin, outlineUiPlugin, canvasUiPlugin, layoutUiPlugin, plugin]);
    const right = useWorkspaceStore.getState().openBeside("main", "/node/n.root-b");
    vi.advanceTimersByTime(SCREEN_PUBLISH_MS);
    expect(published.at(-1)).toMatchObject({
      route: "/node/n.root-b",
      activePane: right,
      panes: [
        { id: "main", route: "/", view: { key: "outline.main" } },
        { id: right, route: "/node/n.root-b", view: { key: "outline.main" } },
      ],
    });

    // A command for the pane that is not focused moves that pane, not the URL.
    useWorkspaceStore.getState().focus("main");
    expect(carryOut({ kind: "navigate", pane: right, to: { route: "/canvas" } })).toEqual({
      outcome: "applied",
    });
    expect(getPath()).toBe("/");
    expect(layoutPanes(useWorkspaceStore.getState().layout).map((pane) => pane.path)).toEqual([
      "/",
      "/canvas",
    ]);

    // A select goes to the view in the pane it names.
    const selectRight = vi.fn((): ScreenAck => ({ outcome: "applied" }));
    useScreenStore.setState({
      panes: {
        [right]: {
          report: { focused: null, selection: [] },
          select: selectRight,
          owner: Symbol("right"),
        },
      },
    });
    expect(carryOut({ kind: "select", pane: right, selection: ["n.root-a"] })).toEqual({
      outcome: "applied",
    });
    expect(selectRight).toHaveBeenCalledWith({ selection: ["n.root-a"] });
    expect(carryOut({ kind: "select", selection: [] })).toEqual({
      outcome: "rejected",
      reason: "the open view takes no selection",
    });
  });

  it("names the view node a pane shows, and the view it opened in", () => {
    const { plugin, published } = tab();
    // The view a node opens in is named through the page's catalog: core's declared views.
    syncUiPlugins([declarationPlugin(coreExtension), outlineUiPlugin, layoutUiPlugin, plugin]);
    navigate("/node/lens.all-mentions");
    vi.advanceTimersByTime(SCREEN_PUBLISH_MS);
    expect(published.at(-1)?.panes[0]).toMatchObject({
      route: "/node/lens.all-mentions",
      view: { key: "graph.page", node: "lens.all-mentions" },
    });
  });

  it("hands a select to the open view, whose answer is the tab's", () => {
    const { plugin, carryOut } = tab();
    syncUiPlugins([outlineUiPlugin, plugin]);
    expect(carryOut({ kind: "select", selection: [] })).toEqual({
      outcome: "rejected",
      reason: "the open view takes no selection",
    });
    const select = vi.fn((): ScreenAck => ({ outcome: "applied" }));
    report(select);
    expect(carryOut({ kind: "select", selection: ["n.root-a"], focus: "n.root-a" })).toEqual({
      outcome: "applied",
    });
    expect(select).toHaveBeenCalledWith({ selection: ["n.root-a"], focus: "n.root-a" });
  });

  it("refuses a pane it does not have", () => {
    const { plugin, carryOut } = tab();
    syncUiPlugins([outlineUiPlugin, plugin]);
    expect(carryOut({ kind: "navigate", pane: "right", to: { route: "/" } })).toEqual({
      outcome: "rejected",
      reason: "no pane right; this tab has main",
    });
  });

  it("picks a fresh id and publishes again when its id is refused", () => {
    const { plugin, ids, refused } = tab();
    syncUiPlugins([outlineUiPlugin, plugin]);
    expect(ids).toEqual(["tab.first"]);
    // A refusal for an id it no longer uses changes nothing.
    refused("tab.other");
    expect(ids).toEqual(["tab.first"]);
    refused("tab.first");
    expect(ids).toHaveLength(2);
    expect(ids[1]).not.toBe("tab.first");
  });

  it("retries a screen it could not read on the next tick, without another change", () => {
    const { plugin, published } = tab();
    syncUiPlugins([outlineUiPlugin, plugin]);
    // A subject no record holds, as a view part-way through an update might report.
    const midUpdate = { subject: "", focused: null, selection: [] };
    useScreenStore.setState({
      panes: {
        main: { report: midUpdate, select: () => SCREEN_APPLIED, owner: Symbol("test view") },
      },
    });
    vi.advanceTimersByTime(SCREEN_PUBLISH_MS);
    expect(published).toHaveLength(1);
    // The view finishes without the store announcing anything: only a retry can see it.
    midUpdate.subject = "n.root-a";
    vi.advanceTimersByTime(SCREEN_PUBLISH_MS);
    expect(published.at(-1)?.panes[0]?.view).toEqual({
      key: "outline.main",
      subject: "n.root-a",
    });
  });

  it("does nothing where there is no page", () => {
    const { plugin, published, installed } = tab(() => null);
    syncUiPlugins([outlineUiPlugin, plugin]);
    expect(published).toEqual([]);
    expect(installed()).toBe(false);
  });

  it("stops publishing and carrying out commands when it unloads", () => {
    const { plugin, published, installed } = tab();
    syncUiPlugins([outlineUiPlugin, plugin]);
    expect(installed()).toBe(true);
    syncUiPlugins([outlineUiPlugin]);
    expect(installed()).toBe(false);
    navigate("/canvas");
    vi.advanceTimersByTime(SCREEN_PUBLISH_MS);
    expect(published).toHaveLength(1);
  });
});
