/**
 * This tab's screen, for agents (`DESIGN.md` → Screen state): the tab
 * publishes what it shows over `/ws` whenever that changes, at most once per
 * {@link SCREEN_PUBLISH_MS}, and carries out the `ui.navigate` / `ui.select`
 * commands the server sends it. It is a built-in plugin, so it starts and
 * stops with the UI kernel.
 *
 * Every pane of the workspace is in it (`stores/workspace.store`): its
 * location, and the view that location resolves to — for a node opened at
 * `/node/<id>`, the view it opened in and the view node it shows. What the
 * view shows — the node it is shown for, focus, selection, a canvas's
 * camera — the mounted view reports under its pane (`stores/screen.store`).
 * A command goes to the pane it names, else the focused one.
 */
import { Effect, Result } from "effect";
import {
  SCREEN_APPLIED,
  ScreenStateSchema,
  screenRejected,
  type ScreenAck,
  type ScreenCommand,
  type ScreenState,
} from "@kb/contracts";
import { definePlugin, type Plugin } from "@kb/plugin";
import { getClientOrigin } from "@/api/action";
import { getLiveClient, setScreenTab, type ScreenTab } from "@/api/live";
import { NodeView, layoutPanes, resolveNodeView, type LayoutPane } from "@kb/views";
import { logWarn } from "@/lib/log";
import { RoutePoint, currentContributions, matchRoute, paramsOf } from "@/lib/plugins";
import { getPath, nodePath, subscribePath } from "@/lib/router";
import { schemaOf } from "@/lib/schema";
import { useOutlineStore } from "@/stores/outline.store";
import { useScreenStore } from "@/stores/screen.store";
import { useWorkspaceStore } from "@/stores/workspace.store";

/** How often, at most, a tab publishes its screen. */
export const SCREEN_PUBLISH_MS = 100;

/**
 * The view a pane at `route` shows: the route's view, or, for a node opened
 * at `/node/<id>`, the view it resolves to and the view node it shows.
 */
function viewAt(route: string): { key: string; node?: string } | null {
  const matched = matchRoute(currentContributions(RoutePoint), route);
  if (matched === null) return null;
  const opened = paramsOf(matched, NodeView);
  if (opened === null) return { key: matched.view.id };
  const schema = schemaOf(useOutlineStore.getState());
  const target = resolveNodeView(
    opened,
    (id) => schema.get(id),
    () => {},
  );
  if (Result.isFailure(target)) return { key: matched.view.id };
  const { key, viewNode } = target.success;
  return viewNode === undefined ? { key: key.id } : { key: key.id, node: viewNode };
}

/**
 * One workspace pane as the screen reports it. A dashboard's own panes are
 * part of its pane's view: they are not listed, and no command names one.
 * GAP [[01M411FPSNN7B18JQ62RKB8ZXW]]
 */
function paneScreen(pane: LayoutPane) {
  const report = useScreenStore.getState().panes[pane.id]?.report;
  const view = viewAt(pane.path);
  const subject = report?.subject;
  return {
    id: pane.id,
    route: pane.path,
    view: view === null ? null : { ...view, ...(subject === undefined ? {} : { subject }) },
    focused: report?.focused ?? null,
    selection: [...(report?.selection ?? [])],
    ...(report?.canvas === undefined ? {} : { canvas: report.canvas }),
  };
}

/** This tab's screen now, or why what the views reported is not a screen. */
function readScreen(document: Document) {
  const { layout, focused } = useWorkspaceStore.getState();
  return ScreenStateSchema.safeParse({
    route: getPath(),
    // Whether the person is looking at this tab.
    active: document.visibilityState === "visible" && document.hasFocus(),
    activePane: focused,
    panes: layoutPanes(layout).map(paneScreen),
  });
}

/** Show `route` in `pane`, when a view owns it. */
function openRoute(pane: string, route: string): ScreenAck {
  if (matchRoute(currentContributions(RoutePoint), route) === null) {
    return screenRejected(`no view owns ${route}`);
  }
  useWorkspaceStore.getState().navigatePane(pane, route);
  return SCREEN_APPLIED;
}

/** Open a node in `pane`, in its default view: the one route a node is opened by. */
function openNode(pane: string, id: string): ScreenAck {
  if (!schemaOf(useOutlineStore.getState()).has(id)) return screenRejected(`no node ${id}`);
  return openRoute(pane, nodePath(id));
}

/** Carry out one of the server's screen commands in this tab. */
function carryOut(command: ScreenCommand): ScreenAck {
  const { layout, focused } = useWorkspaceStore.getState();
  const ids = layoutPanes(layout).map((pane) => pane.id);
  const pane = command.pane ?? focused;
  if (!ids.includes(pane)) {
    return screenRejected(`no pane ${pane}; this tab has ${ids.join(", ")}`);
  }
  if (command.kind === "navigate") {
    return "node" in command.to
      ? openNode(pane, command.to.node)
      : openRoute(pane, command.to.route);
  }
  const select = useScreenStore.getState().panes[pane]?.select;
  if (select === undefined) return screenRejected("the open view takes no selection");
  return select({
    ...(command.selection === undefined ? {} : { selection: command.selection }),
    ...(command.focus === undefined ? {} : { focus: command.focus }),
  });
}

/** Call `listener` whenever this tab's screen may have changed; returns the unsubscribe. */
function watchScreen(page: Window, listener: () => void): () => void {
  const offPath = subscribePath(listener);
  const offView = useScreenStore.subscribe(listener);
  const offPanes = useWorkspaceStore.subscribe(listener);
  page.addEventListener("focus", listener);
  page.addEventListener("blur", listener);
  page.document.addEventListener("visibilitychange", listener);
  return () => {
    offPath();
    offView();
    offPanes();
    page.removeEventListener("focus", listener);
    page.removeEventListener("blur", listener);
    page.document.removeEventListener("visibilitychange", listener);
  };
}

export interface ScreenPluginOptions {
  /** The tab's window; null where there is none (a test, a server render), and then the plugin does nothing. */
  readonly page: () => Window | null;
  /** The id the tab first publishes as. */
  readonly tabId: () => string;
  /** Send this tab's screen to the server, as the tab `tab`. */
  readonly publish: (tab: string, state: ScreenState) => void;
  /** Install (or, with null, remove) the tab's side of what the server says. */
  readonly attach: (tab: ScreenTab | null) => void;
}

interface Publisher {
  readonly stop: () => void;
  /** The server refused `taken`: when that is this tab's id, pick a fresh one and publish again. */
  readonly refused: (taken: string) => void;
}

/**
 * Publish the screen now, then again after every change, at most once per
 * {@link SCREEN_PUBLISH_MS} and only when it differs from the last one sent.
 */
function startPublishing(
  page: Window,
  firstTab: string,
  publish: (tab: string, state: ScreenState) => void,
): Publisher {
  let tab = firstTab;
  let last = "";
  let lastProblem = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = (): void => {
    timer ??= setTimeout(flush, SCREEN_PUBLISH_MS);
  };
  function flush(): void {
    timer = null;
    const read = readScreen(page.document);
    // A view part-way through an update can report what no screen holds.
    // Try again on the next tick rather than wait for another change, and
    // say so once per problem, not once per tick.
    if (!read.success) {
      if (read.error.message !== lastProblem) {
        logWarn(`[kb/screen] not published yet: ${read.error.message}`);
      }
      lastProblem = read.error.message;
      schedule();
      return;
    }
    lastProblem = "";
    const text = JSON.stringify(read.data);
    if (text === last) return;
    last = text;
    publish(tab, read.data);
  }
  const unwatch = watchScreen(page, schedule);
  flush();
  return {
    stop: () => {
      unwatch();
      if (timer !== null) clearTimeout(timer);
    },
    refused: (taken) => {
      if (taken !== tab) return;
      tab = crypto.randomUUID();
      last = "";
      flush();
    },
  };
}

export function screenPlugin(options: ScreenPluginOptions): Plugin {
  return definePlugin({
    name: "screen",
    apply: () =>
      Effect.asVoid(
        Effect.acquireRelease(
          Effect.sync(() => {
            const page = options.page();
            if (page === null) return () => undefined;
            const publisher = startPublishing(page, options.tabId(), options.publish);
            options.attach({ carryOut, refused: publisher.refused });
            return () => {
              publisher.stop();
              options.attach(null);
            };
          }),
          (stop) => Effect.sync(stop),
        ),
      ),
  });
}

export const screenUiPlugin = screenPlugin({
  page: () => (typeof window === "undefined" ? null : window),
  // The page's origin id: one per page load, so per tab, and the id its writes carry.
  tabId: getClientOrigin,
  publish: (tab, state) => getLiveClient().publishScreen(tab, state),
  attach: setScreenTab,
});
