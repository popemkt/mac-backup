/**
 * This tab's screen, for agents (`DESIGN.md` → Screen state): the tab
 * publishes what it shows over `/ws` whenever that changes, at most once per
 * {@link SCREEN_PUBLISH_MS}, and carries out the `ui.navigate` / `ui.select`
 * commands the server sends it. It is a built-in plugin, so it starts and
 * stops with the UI kernel.
 *
 * The route and the view key are the shell's; what the view shows — the node
 * it is shown for, focus, selection, a canvas's viewport — the mounted view
 * reports (`stores/screen.store`). A tab has one pane today, `main`.
 */
import { Effect } from "effect";
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
import { logWarn } from "@/lib/log";
import { RoutePoint, currentContributions, matchRoute } from "@/lib/plugins";
import { getPath, navigate, subscribePath } from "@/lib/router";
import { useOutlineStore } from "@/stores/outline.store";
import { useScreenStore } from "@/stores/screen.store";

/** The one pane a tab has until windowing lands. */
const MAIN_PANE = "main";

/** How often, at most, a tab publishes its screen. */
export const SCREEN_PUBLISH_MS = 100;

/** This tab's screen now, or why what the view reported is not a screen. */
function readScreen(document: Document) {
  const route = getPath();
  const matched = matchRoute(currentContributions(RoutePoint), route);
  const { report } = useScreenStore.getState();
  const subject = report?.subject;
  return ScreenStateSchema.safeParse({
    route,
    // Whether the person is looking at this tab.
    active: document.visibilityState === "visible" && document.hasFocus(),
    activePane: MAIN_PANE,
    panes: [
      {
        id: MAIN_PANE,
        view:
          matched === null
            ? null
            : { key: matched.view.id, ...(subject === undefined ? {} : { subject }) },
        focused: report?.focused ?? null,
        selection: [...(report?.selection ?? [])],
        ...(report?.canvas === undefined ? {} : { canvas: report.canvas }),
      },
    ],
  });
}

function openRoute(route: string): ScreenAck {
  if (matchRoute(currentContributions(RoutePoint), route) === null) {
    return screenRejected(`no view owns ${route}`);
  }
  navigate(route);
  return SCREEN_APPLIED;
}

/**
 * Open a node: the outline, zoomed to it.
 */
// GAP [GAP-OPEN-NODE]
function openNode(id: string): ScreenAck {
  const outline = useOutlineStore.getState();
  if (!outline.nodes.has(id) && !outline.wireNodes.some((node) => node.id === id)) {
    return screenRejected(`no node ${id}`);
  }
  navigate("/");
  outline.zoomTo(id);
  return useOutlineStore.getState().rootNodeId === id
    ? SCREEN_APPLIED
    : screenRejected(`the outline cannot open ${id}`);
}

/** Carry out one of the server's screen commands in this tab. */
function carryOut(command: ScreenCommand): ScreenAck {
  if (command.pane !== undefined && command.pane !== MAIN_PANE) {
    return screenRejected(`no pane ${command.pane}; this tab has one, ${MAIN_PANE}`);
  }
  if (command.kind === "navigate") {
    return "node" in command.to ? openNode(command.to.node) : openRoute(command.to.route);
  }
  const { select } = useScreenStore.getState();
  if (select === null) return screenRejected("the open view takes no selection");
  return select({
    ...(command.selection === undefined ? {} : { selection: command.selection }),
    ...(command.focus === undefined ? {} : { focus: command.focus }),
  });
}

/** Call `listener` whenever this tab's screen may have changed; returns the unsubscribe. */
function watchScreen(page: Window, listener: () => void): () => void {
  const offPath = subscribePath(listener);
  const offView = useScreenStore.subscribe(listener);
  page.addEventListener("focus", listener);
  page.addEventListener("blur", listener);
  page.document.addEventListener("visibilitychange", listener);
  return () => {
    offPath();
    offView();
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
