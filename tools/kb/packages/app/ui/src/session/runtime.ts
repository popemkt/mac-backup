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
import { invokeReceiptWith, isomorphicActions, noteStoreSynced } from "@kb/operations";
import { postAction, type ActionResponse } from "@/api/action";
import { toast } from "@/lib/toast";
import { BrowserStore } from "./browser-store";
import { BrowserReplica, type Hold, type ReplicaLink } from "./replica";

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

/**
 * Where an action can run is decided by what its handler needs, not by its
 * mode: `isomorphicActions` are those whose handlers need only the store and
 * index (`IsomorphicActionEnv`), whether they read or write.
 */
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
      nodes,
      rev,
      {
        apply: view.applyServerTx,
        install: view.installServerSnapshot,
        local: (id) => index.getNode(id),
      },
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

function requireSession(): BrowserSession {
  if (session === null) throw new Error("browser kb session is not hydrated");
  return session;
}

/**
 * One ordered network lane for browser mutations. A push that carries a hold
 * settles it with its receipt (DESIGN-UI.md → Replica sync → Holds).
 */
export function pushInvocation(invocation: ActionInvocation, hold?: Hold): Promise<ActionResponse> {
  const result = pushTail
    .catch(() => undefined)
    .then(() => postAction(invocation.id, invocation.input));
  pushTail = result.then(
    () => undefined,
    () => undefined,
  );
  if (hold === undefined) return result;
  const { replica } = requireSession();
  return result.then(
    (response) => {
      if (response.status === "succeeded") replica.settle(hold, response.rev);
      else replica.drop(hold);
      return response;
    },
    (error: unknown) => {
      replica.drop(hold);
      throw error;
    },
  );
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
    // Only a write commits; a read leaves the outline store nothing to project.
    const writes = localActions.get(invocation.id)?.def.mode.kind === "write";
    if (writes && receipt.status === "succeeded") current.onLocalCommit();
    return receipt;
  });
}

/**
 * A local write that will be pushed: commit it, and hold every id the commit
 * touched until the push settles. `into` joins an open hold (typed text).
 */
export async function writeLocal(
  invocation: ActionInvocation,
  into?: Hold,
): Promise<{ receipt: ActionReceipt; hold?: Hold }> {
  const current = requireSession();
  const before = current.store.txTail.head();
  const receipt = await invokeLocal(invocation);
  if (receipt.status === "failed") return { receipt };
  const touched = current.store.txTail
    .entries()
    .flatMap((tx) =>
      tx.rev > before ? [...tx.ops.upserts.map((node) => node.id), ...tx.ops.deletes] : [],
    );
  return { receipt, hold: current.replica.hold(touched, into) };
}

function surfacePushFailure(receipt: ActionReceipt): void {
  if (receipt.status === "failed") toast(receipt.message);
}

/**
 * Run an action where it can run. An action whose handler needs only the
 * store and index runs locally first. A local read is then done, because it
 * has nothing to replicate. A local write is pushed so the server commits it
 * too. Any other action goes to the server.
 */
export async function invoke(id: string, input: unknown): Promise<ActionReceipt> {
  const invocation: ActionInvocation = { id, input };
  const local = localActions.get(id);
  if (local === undefined) return pushInvocation(invocation);
  if (local.def.mode.kind === "read") return invokeLocal(invocation);
  const { receipt, hold } = await writeLocal(invocation);
  if (receipt.status === "failed") return receipt;
  void pushInvocation(invocation, hold).then(surfacePushFailure, (error: unknown) => {
    toast(error instanceof Error ? error.message : String(error));
  });
  return receipt;
}
