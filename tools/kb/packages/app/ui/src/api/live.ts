/**
 * Singleton live connection: carries the socket's graph stream into the
 * browser replica's sync machine (session/replica.ts), runs the network moves
 * it asks for (`since`, the /api/graph snapshot), and wires the ui store
 * (status indicator, error toasts).
 */
import { fetchGraphSnapshot } from "@/api/graph";
import { KbWsClient, type KbWsClientOptions } from "@/api/ws";
import { useUiStore } from "@/stores/ui.store"; // GAP [[01M1RXMQYDBWX4EWJPEFRDR05H]]
import { mergeRemoteUpserts } from "@/actions/mutations";
import { browserReplica, setBrowserLink } from "@/session/runtime";

let client: KbWsClient | null = null;

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
    onGraph: (msg) =>
      browserReplica()?.receive(
        msg.op === "tx" ? { ...msg, upserts: mergeRemoteUpserts(msg.upserts) } : msg,
      ),
    onStatus: (status) => useUiStore.getState().setWsStatus(status),
    onServerError: (err) =>
      useUiStore.getState().pushToast("error", `ws ${err.code}: ${err.message}`),
    ...overrides,
  });
  setBrowserLink({ since: (rev) => next.since(rev), fetchSnapshot });
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
