/**
 * Singleton live connection: carries the socket's graph stream into the
 * browser replica's sync machine (session/replica.ts), runs the network moves
 * it asks for (`since`, the /api/graph snapshot), wires the ui store
 * (status indicator, error toasts), and hands what the server says about this
 * tab's screen to whatever the tab has installed for it (`src/screen.ts`).
 */
import { screenRejected, type ScreenAck, type ScreenCommand } from "@kb/contracts";
import { fetchGraphSnapshot } from "@/api/graph";
import { KbWsClient, type KbWsClientOptions } from "@/api/ws";
import { useUiStore } from "@/stores/ui.store"; // GAP [[01M1RXMQYDBWX4EWJPEFRDR05H]]
import { browserReplica, setBrowserLink } from "@/session/runtime";

let client: KbWsClient | null = null;

/** What the server says about this tab's screen, and how the tab answers it. */
export interface ScreenTab {
  /** Carry out a command; the answer goes back to the server. */
  readonly carryOut: (command: ScreenCommand) => ScreenAck;
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
  target.answerScreenCommand(id, answer);
}

/** The snapshot the machine asked for, strictly from /api/graph (never fixtures). */
function fetchSnapshot(): void {
  void fetchGraphSnapshot().then(
    (snapshot) => browserReplica()?.receive({ op: "snapshot", snapshot }),
    (err: unknown) => {
      useUiStore
        .getState()
        .pushToast(
          "error",
          `graph resync failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      browserReplica()?.receive({ op: "snapshot-failed" });
    },
  );
}

/** Store-wired client; overrides let tests inject a fake socket. */
export function createLiveClient(overrides: Partial<KbWsClientOptions> = {}): KbWsClient {
  const next = new KbWsClient({
    onGraph: (msg) => browserReplica()?.receive(msg),
    onStatus: (status) => useUiStore.getState().setWsStatus(status),
    onServerError: (err) =>
      useUiStore.getState().pushToast("error", `ws ${err.code}: ${err.message}`),
    onScreenCommand: (id, command) => answerScreenCommand(next, id, command),
    onScreenRefused: (tab) => screenTab?.refused(tab),
    ...overrides,
  });
  setBrowserLink({
    since: (rev) => next.since(rev),
    fetchSnapshot,
    retryAfter: (ms) => setTimeout(() => browserReplica()?.receive({ op: "retry" }), ms),
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
