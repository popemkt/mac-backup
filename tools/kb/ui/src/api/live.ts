/**
 * Singleton live connection: wires KbWsClient into the outline store
 * (tx deltas via applyTx, rev-gap resync via /api/graph refetch) and the
 * ui store (status indicator, error toasts).
 */
import { fetchGraphSnapshot } from "@/api/graph";
import { KbWsClient, type KbWsClientOptions } from "@/api/ws";
import { useOutlineStore } from "@/stores/outline.store";
import { useUiStore } from "@/stores/ui.store";
import { mergeRemoteUpserts } from "@/actions/mutations";

let client: KbWsClient | null = null;
let refetching = false;

/** Rev gap → strict resync from /api/graph (never fixtures). Exported for tests. */
export async function refetchGraph(): Promise<void> {
  if (refetching) return;
  refetching = true;
  try {
    const snapshot = await fetchGraphSnapshot();
    useOutlineStore
      .getState()
      .refreshFromWire(snapshot.nodes, snapshot.rev);
  } catch (err) {
    useUiStore
      .getState()
      .pushToast(
        "error",
        `graph resync failed: ${err instanceof Error ? err.message : String(err)}`,
      );
  } finally {
    refetching = false;
  }
}

/** Store-wired client; overrides let tests inject a fake socket. */
export function createLiveClient(
  overrides: Partial<KbWsClientOptions> = {},
): KbWsClient {
  return new KbWsClient({
    getRev: () => useOutlineStore.getState().rev,
    onTx: (tx) =>
      useOutlineStore.getState().applyTx(mergeRemoteUpserts(tx.upserts), tx.deletes, { rev: tx.rev }),
    onGap: () => void refetchGraph(),
    onStatus: (status) => useUiStore.getState().setWsStatus(status),
    onServerError: (err) =>
      useUiStore
        .getState()
        .pushToast("error", `ws ${err.code}: ${err.message}`),
    ...overrides,
  });
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
