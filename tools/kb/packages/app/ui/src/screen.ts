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
import { getLiveClient, setScreenCommandHandler, type ScreenCommandHandler } from "@/api/live";
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
  /** Send this tab's screen to the server. */
  readonly publish: (state: ScreenState) => void;
  /** Install (or, with null, remove) what carries out the server's commands. */
  readonly handleCommands: (handler: ScreenCommandHandler | null) => void;
}

/**
 * Publish the screen now, then again after every change, at most once per
 * {@link SCREEN_PUBLISH_MS} and only when it differs from the last one sent.
 */
function startPublishing(page: Window, publish: (state: ScreenState) => void): () => void {
  let last = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = (): void => {
    timer = null;
    const read = readScreen(page.document);
    // A view that reported something no screen can hold is a bug in that
    // view; the tab says so and keeps the last screen it sent.
    if (!read.success) {
      logWarn(`[kb/screen] not published: ${read.error.message}`);
      return;
    }
    const state = read.data;
    const text = JSON.stringify(state);
    if (text === last) return;
    last = text;
    publish(state);
  };
  const stop = watchScreen(page, () => {
    timer ??= setTimeout(flush, SCREEN_PUBLISH_MS);
  });
  flush();
  return () => {
    stop();
    if (timer !== null) clearTimeout(timer);
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
            options.handleCommands(carryOut);
            const stopPublishing = startPublishing(page, options.publish);
            return () => {
              stopPublishing();
              options.handleCommands(null);
            };
          }),
          (stop) => Effect.sync(stop),
        ),
      ),
  });
}

export const screenUiPlugin = screenPlugin({
  page: () => (typeof window === "undefined" ? null : window),
  publish: (state) => getLiveClient().publishScreen(state),
  handleCommands: setScreenCommandHandler,
});
