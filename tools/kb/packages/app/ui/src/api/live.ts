/**
 * Singleton live connection: carries the socket's graph stream into the
 * browser replica's sync machine (session/replica.ts), runs the network moves
 * it asks for (`since`, the /api/graph snapshot), wires the ui store
 * (status indicator, error toasts), and hands what the server says about this
 * tab's screen to whatever the tab has installed for it (`src/screen.ts`).
 *
 * This is the one place live updates enter the replica, and it hands them over
 * at most once per animation frame: everything that arrived since the last
 * frame — frames, hellos, a fetched snapshot — is one `receiveAll`, which the
 * replica applies as one view update (DESIGN-UI.md → Replica sync). Holding an
 * event for a frame is network latency to the machine, which it already
 * tolerates; a burst of frames no longer costs a projection each.
 */
import { screenRejected, type ScreenAck, type ScreenCommand } from "@kb/contracts";
import { fetchGraphSnapshot } from "@/api/graph";
import { KbWsClient, type KbWsClientOptions } from "@/api/ws";
import { useUiStore } from "@/stores/ui.store"; // GAP [[01M1RXMQYDBWX4EWJPEFRDR05H]]
import { browserReplica, setBrowserLink } from "@/session/runtime";
import type { SyncEvent } from "@/session/replica";

let client: KbWsClient | null = null;

/** What the server says about this tab's screen, and how the tab answers it. */
export interface ScreenTab {
  /** Carry out a command; the answer, now or once there is one, goes back to the server. */
  readonly carryOut: (command: ScreenCommand) => ScreenAck | Promise<ScreenAck>;
  /** A screen published as `tab` was refused: another live connection owns that id. */
  readonly refused: (tab: string) => void;
}
let screenTab: ScreenTab | null = null;

/** Install (or, with null, remove) this tab's screen side. */
export function setScreenTab(next: ScreenTab | null): void {
  screenTab = next;
}

function answerScreenCommand(target: KbWsClient, id: string, command: ScreenCommand): void {
  const answer =
    screenTab === null
      ? screenRejected("this tab carries out no screen commands")
      : screenTab.carryOut(command);
  if (!(answer instanceof Promise)) {
    target.answerScreenCommand(id, answer);
    return;
  }
  // A view that answers later still answers: one that fails says so rather than going quiet.
  void answer.then(
    (ack) => target.answerScreenCommand(id, ack),
    (err: unknown) =>
      target.answerScreenCommand(
        id,
        screenRejected(err instanceof Error ? err.message : String(err)),
      ),
  );
}

/** The snapshot the machine asked for, strictly from /api/graph (never fixtures). */
function fetchSnapshot(deliver: (event: SyncEvent) => void): void {
  void fetchGraphSnapshot().then(
    (snapshot) => deliver({ op: "snapshot", snapshot }),
    (err: unknown) => {
      useUiStore
        .getState()
        .pushToast(
          "error",
          `graph resync failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      deliver({ op: "snapshot-failed" });
    },
  );
}

/**
 * Run `drain` with the next frame. A hidden tab paints none, so it drains on
 * a timer instead (which the browser throttles), and so does a runtime with
 * no frames at all.
 */
function nextFrame(drain: () => void): void {
  const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
  if (typeof requestAnimationFrame === "function" && !hidden) requestAnimationFrame(drain);
  else setTimeout(drain, 0);
}

/** The replica's inbox: events in arrival order, handed over once per frame. */
function frameInbox(): (event: SyncEvent) => void {
  let events: SyncEvent[] = [];
  let scheduled = false;
  const drain = (): void => {
    scheduled = false;
    const burst = events;
    events = [];
    browserReplica()?.receiveAll(burst);
  };
  return (event) => {
    events.push(event);
    if (scheduled) return;
    scheduled = true;
    nextFrame(drain);
  };
}

/** Store-wired client; overrides let tests inject a fake socket. */
export function createLiveClient(overrides: Partial<KbWsClientOptions> = {}): KbWsClient {
  const deliver = frameInbox();
  const next = new KbWsClient({
    onGraph: deliver,
    onStatus: (status) => useUiStore.getState().setWsStatus(status),
    onServerError: (err) =>
      useUiStore.getState().pushToast("error", `ws ${err.code}: ${err.message}`),
    onScreenCommand: (id, command) => answerScreenCommand(next, id, command),
    onScreenRefused: (tab) => screenTab?.refused(tab),
    ...overrides,
  });
  setBrowserLink({
    since: (rev) => next.since(rev),
    fetchSnapshot: () => fetchSnapshot(deliver),
    retryAfter: (ms) => setTimeout(() => deliver({ op: "retry" }), ms),
  });
  return next;
}

export function getLiveClient(): KbWsClient {
  if (!client) client = createLiveClient();
  return client;
}

/** Idempotent: called from App mount. No-op when already connected. */
export function ensureLiveConnection(): void {
  const c = getLiveClient();
  if (c.status === "idle" || c.status === "closed") c.connect();
}
