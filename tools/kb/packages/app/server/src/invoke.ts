import { Effect } from "effect";
import type { ActionInvocation, ActionReceipt, KbContext } from "@kb/contracts";
import type { DomainError } from "@kb/model";
import { reloadEffect } from "@kb/operations";
import { type ActionHandlerEnv, invokeReceiptEffect } from "@kb/runtime";

/**
 * How the `kb ui` server runs an invocation it is handed: over the session
 * brought up to date first, so a write another process made is not missed,
 * then through the invoke core. What the invocation commits reaches watchers
 * through the log, which the hub is already subscribed to: persist → log →
 * hub, with no second path from here and nothing to wait for fs.watch to
 * notice. A store that cannot be reloaded fails here; the caller says what
 * that means on its wire.
 */
export const serverInvoke = Effect.fn("kb.ui.invoke")(function* (
  ctx: KbContext,
  invocation: ActionInvocation,
): Effect.fn.Return<ActionReceipt, DomainError, ActionHandlerEnv> {
  yield* reloadEffect(ctx);
  return yield* invokeReceiptEffect(ctx, invocation);
});
