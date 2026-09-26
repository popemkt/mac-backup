import { Effect, Layer } from "effect";
import {
  type ActionInvocation,
  type ActionReceipt,
  type KbContext,
  type KbCtx,
  type KbStore,
  kbCtxLayer,
  kbStoreLayer,
} from "@kb/contracts";
import type { KbNode, StoreTx } from "@kb/model";
import { KbIndexService, type KbIndex } from "@kb/query"; // GAP [[01M1RXNP3EMV1ES85BVE9CXMYE]]
import { StoreTxLog } from "@kb/tx-log";
import { invokeReceiptWith, isomorphicActions, noteStoreSynced, portActions } from "@kb/operations";
import { postAction } from "@/api/action";
import { toast } from "@/lib/toast";
import { BrowserStore } from "./browser-store";
import { BrowserReplica, type ReplicaLink } from "./replica";

/** How the outline store projects the session: local commits, server deltas, snapshots. */
export interface BrowserSessionView {
  readonly onLocalCommit: () => void;
  readonly applyServerTx: (tx: StoreTx, rev: number) => void;
  readonly installServerSnapshot: (nodes: KbNode[], rev: number) => void;
}

interface BrowserSession {
  readonly ctx: KbContext;
  readonly store: BrowserStore;
  readonly layer: Layer.Layer<KbCtx | KbStore | KbIndexService>;
  readonly onLocalCommit: () => void;
  readonly replica: BrowserReplica;
}

let session: BrowserSession | null = null;
let link: ReplicaLink | null = null;
let pushTail = Promise.resolve();

const remoteOnlyActions = new Set(portActions.map((action) => action.def.id));
const localActions = new Map(isomorphicActions.map((action) => [action.def.id, action]));

function noteBrowserStoreSynced(current: BrowserSession): void {
  Effect.runSync(noteStoreSynced(current.ctx).pipe(Effect.provide(current.layer)));
}

/** Install the browser infrastructure around the outline store's one index. */
export function replaceBrowserSession(
  nodes: readonly KbNode[],
  rev: number,
  index: KbIndex,
  view: BrowserSessionView,
): void {
  const store = new BrowserStore(nodes);
  const ctx: KbContext = {
    root: "browser",
    store,
    index,
    log: new StoreTxLog(store.txTail),
    get nodes(): KbNode[] {
      return index.storedNodes();
    },
  };
  const nextSession: BrowserSession = {
    ctx,
    store,
    layer: Layer.mergeAll(
      kbStoreLayer(store),
      kbCtxLayer(ctx),
      Layer.succeed(KbIndexService, index),
    ),
    onLocalCommit: view.onLocalCommit,
    replica: new BrowserReplica(
      rev,
      { apply: view.applyServerTx, install: view.installServerSnapshot },
      () => link,
    ),
  };
  session = nextSession;
  noteBrowserStoreSynced(nextSession);
}

/** Advance the replicated store and index together when a server tx arrives. */
export function ingestBrowserTx(tx: StoreTx): void {
  const current = session;
  if (current === null) return;
  current.store.apply(tx);
  current.ctx.index.applyTx(tx);
  noteBrowserStoreSynced(current);
}

/** Replace the replicated store and index with an authoritative server snapshot. */
export function installBrowserNodes(nodes: readonly KbNode[]): void {
  const current = requireSession();
  current.store.replace(nodes);
  current.ctx.index.rebuild([...nodes]);
  noteBrowserStoreSynced(current);
}

/** The current session's sync machine; null before the first hydrate. */
export function browserReplica(): BrowserReplica | null {
  return session?.replica ?? null;
}

/** The network the sync machine talks through (the live socket and /api/graph). */
export function setBrowserLink(next: ReplicaLink | null): void {
  link = next;
}

export function reconcileBrowserSession(): void {
  session?.replica.receive({ op: "reconcile" });
}

function requireSession(): BrowserSession {
  if (session === null) throw new Error("browser kb session is not hydrated");
  return session;
}

/**
 * One ordered network lane for browser mutations. Server failure asks the
 * live socket for `since(rev)`; only the socket may escalate that to snapshot.
 */
export function pushInvocation(invocation: ActionInvocation): Promise<ActionReceipt> {
  const result = pushTail
    .catch(() => undefined)
    .then(() => postAction(invocation.id, invocation.input));
  pushTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** Wait until the ordered push lane drains. Test-only observation seam. */
export function waitForBrowserPushes(): Promise<void> {
  return pushTail;
}

/**
 * Browser action entry point. The shared invoker is wired here once its w5
 * prerequisite export lands; port-backed actions remain server-owned.
 */
export function invokeLocal(invocation: ActionInvocation): Promise<ActionReceipt> {
  const current = requireSession();
  return Effect.runPromise(
    invokeReceiptWith(localActions, current.ctx, invocation).pipe(Effect.provide(current.layer)),
  ).then((receipt) => {
    if (receipt.status === "succeeded") current.onLocalCommit();
    return receipt;
  });
}

function surfacePushFailure(receipt: ActionReceipt): void {
  if (receipt.status === "succeeded") return;
  toast(receipt.message);
  reconcileBrowserSession();
}

export async function invoke(id: string, input: unknown): Promise<ActionReceipt> {
  const invocation: ActionInvocation = { id, input };
  if (remoteOnlyActions.has(id) || !localActions.has(id)) return pushInvocation(invocation);
  const receipt = await invokeLocal(invocation);
  if (receipt.status === "failed") return receipt;
  void pushInvocation(invocation).then(surfacePushFailure, (error: unknown) => {
    toast(error instanceof Error ? error.message : String(error));
    reconcileBrowserSession();
  });
  return receipt;
}
