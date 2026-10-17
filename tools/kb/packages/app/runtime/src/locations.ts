/**
 * A root that a person opens is one of their locations (DESIGN.md →
 * Locations): `kb ui` and `kb init` register the root they open, and no
 * other command does, because hooks and the pre-commit gate run `kb`
 * constantly. The registering is the locations family's `location.register`,
 * called by the alias every surface calls it by, so no surface imports the
 * family.
 */
import { Effect } from "effect";
import type { ActionHandlerEnv, KbContext } from "@kb/contracts";
import { invokeReceiptEffect } from "./registry.ts";

/** The locations family's register, by its bare alias. */
const REGISTER_LOCATION = "location.register";

/**
 * Register `ctx`'s root as a location. Answers null when it is registered,
 * or when no family registers locations here (switched off); otherwise why
 * it is not, which the caller reports and then carries on: a root that is
 * not listed still opens.
 */
export const registerOpenedRoot = Effect.fn("kb.registerOpenedRoot")(function* (
  ctx: KbContext,
): Effect.fn.Return<string | null, never, ActionHandlerEnv> {
  const receipt = yield* invokeReceiptEffect(ctx, {
    id: REGISTER_LOCATION,
    input: { path: ctx.root },
  });
  if (receipt.status === "succeeded" || receipt.code === "unknown_action") return null;
  return receipt.message;
});
