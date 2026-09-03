import { Cause, Effect, Exit } from "effect";
import type { ActionInvocation, ActionReceipt, KbContext } from "@kb/contracts";
import { kbRuntimeLayer } from "./layers.ts";
import { invokeReceiptEffect, receiptFromError } from "./registry.ts";

/**
 * Invoke an action. Never throws across this boundary — failures become
 * receipts. Thin Promise compatibility edge over `invokeReceiptEffect` plus
 * the live Layers; it lives beside the registry rather than inside it so the
 * runtime layer can read the registry's templates without an import cycle.
 */
export async function invoke(ctx: KbContext, invocation: ActionInvocation): Promise<ActionReceipt> {
  const exit = await Effect.runPromiseExit(
    invokeReceiptEffect(ctx, invocation).pipe(Effect.provide(kbRuntimeLayer(ctx))),
  );
  if (Exit.isSuccess(exit)) return exit.value;
  return receiptFromError(invocation.id, Cause.squash(exit.cause));
}
