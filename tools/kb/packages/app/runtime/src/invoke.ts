import { Cause, Effect } from "effect";
import {
  onWire,
  type ActionReceipt,
  type ActionRequest,
  type KbContext,
  type SurfaceWire,
} from "@kb/contracts";
import { kbRuntimeLayer } from "./layers.ts";
import { invokeReceiptEffect, receiptFromError } from "./registry.ts";

/**
 * The wire of kb's own code calling in this process, through {@link invoke}:
 * the owner's, as the command line is, since it runs with what the owner
 * runs it with. A call that says who makes it keeps that.
 */
export const IN_PROCESS_WIRE: SurfaceWire = { carriesApproval: true, actor: "cli" };

/**
 * Invoke an action in this process, made as its request says or else as
 * {@link IN_PROCESS_WIRE} says. Never throws across this boundary — failures become
 * receipts. Thin Promise compatibility edge over `invokeReceiptEffect` plus
 * the live Layers; it lives beside the registry rather than inside it so the
 * runtime layer can read the registry's templates without an import cycle.
 */
export function invoke(ctx: KbContext, request: ActionRequest): Promise<ActionReceipt> {
  return Effect.runPromise(
    invokeReceiptEffect(ctx, onWire(IN_PROCESS_WIRE, request)).pipe(
      Effect.provide(kbRuntimeLayer(ctx)),
      Effect.catchCause((cause) =>
        Effect.succeed(receiptFromError(request.id, Cause.squash(cause))),
      ),
    ),
  );
}
