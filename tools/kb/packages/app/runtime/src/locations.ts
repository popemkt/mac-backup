/**
 * A root that a person opens is one of their locations (DESIGN.md →
 * Locations): `kb ui` and `kb init` register the root they open, and no
 * other command does, because hooks and the pre-commit gate run `kb`
 * constantly. The registering is the locations family's `location.register`,
 * by the alias every surface calls it by (only a composition root imports a
 * family, `EXTENSION_ROOTS`), invoked like any call on the surface the
 * person opened the root from, so approval sees who made it.
 */
import { Effect } from "effect";
import { onWire, type ActionHandlerEnv, type KbContext, type SurfaceWire } from "@kb/contracts";
import { invokeReceiptEffect } from "./registry.ts";

/** The locations family's register, by its bare alias. */
const REGISTER_LOCATION = "location.register";

/**
 * Register `ctx`'s root as a location, as a call on `openedBy`, the wire of
 * the surface that opened it. Answers null when it is registered, or when
 * no family registers locations here (switched off); otherwise why it is
 * not, which the caller reports and then carries on: a root that is not
 * listed still opens.
 */
export const registerOpenedRoot = Effect.fn("kb.registerOpenedRoot")(function* (
  ctx: KbContext,
  openedBy: SurfaceWire,
): Effect.fn.Return<string | null, never, ActionHandlerEnv> {
  const receipt = yield* invokeReceiptEffect(
    ctx,
    onWire(openedBy, { id: REGISTER_LOCATION, input: { path: ctx.root } }),
  );
  if (receipt.status === "succeeded" || receipt.code === "unknown_action") return null;
  return receipt.message;
});
