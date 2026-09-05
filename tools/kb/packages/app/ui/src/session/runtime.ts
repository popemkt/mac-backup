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
import { KbIndexService, type KbIndex } from "@kb/query";
import { MemoryTxLog } from "@kb/tx-log";
import { invokeReceiptWith, isomorphicActions, portActions } from "@kb/operations";
import { postAction } from "@/api/action";
import { toast } from "@/lib/toast";
import { BrowserStore } from "./browser-store";

interface BrowserSession {
  readonly ctx: KbContext;
  readonly store: BrowserStore;
  readonly layer: Layer.Layer<KbCtx | KbStore | KbIndexService>;
  readonly onLocalCommit: () => void;
}

let session: BrowserSession | null = null;
let reconcile: (() => void) | null = null;
let pushTail = Promise.resolve();

const remoteOnlyActions = new Set(portActions.map((action) => action.def.id));
const localActions = new Map(isomorphicActions.map((action) => [action.def.id, action]));

/** Install the browser infrastructure around the outline store's one index. */
export function replaceBrowserSession(
  nodes: readonly KbNode[],
  index: KbIndex,
  onLocalCommit: () => void,
): void {
  const store = new BrowserStore(nodes);
  const ctx: KbContext = {
    root: "browser",
    store,
    index,
    log: new MemoryTxLog(),
    get nodes(): KbNode[] {
      return index.storedNodes();
    },
  };
  session = {
    ctx,
    store,
    layer: Layer.mergeAll(
      kbStoreLayer(store),
      kbCtxLayer(ctx),
      Layer.succeed(KbIndexService, index),
    ),
    onLocalCommit,
  };
}

/** Mirror a server tx into BrowserStore; the outline store advances the index. */
export function ingestBrowserTx(tx: StoreTx): void {
  session?.store.apply(tx);
}

export function setBrowserReconciler(fn: (() => void) | null): void {
  reconcile = fn;
}

export function reconcileBrowserSession(): void {
  reconcile?.();
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
  reconcile?.();
}

export async function invoke(id: string, input: unknown): Promise<ActionReceipt> {
  const invocation: ActionInvocation = { id, input };
  if (remoteOnlyActions.has(id) || !localActions.has(id)) return pushInvocation(invocation);
  const receipt = await invokeLocal(invocation);
  if (receipt.status === "failed") return receipt;
  void pushInvocation(invocation).then(surfacePushFailure, (error: unknown) => {
    toast(error instanceof Error ? error.message : String(error));
    reconcile?.();
  });
  return receipt;
}
