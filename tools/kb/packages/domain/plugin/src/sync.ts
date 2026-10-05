import { Effect, Exit, type Cause } from "effect";
import type { Kernel, Plugin } from "./kernel.ts";

/** One plugin {@link syncPlugins} could not move, and why. */
export interface SyncFailure {
  readonly name: string;
  readonly verb: "load" | "unload";
  readonly cause: Cause.Cause<unknown>;
}

/**
 * Converge `kernel` on exactly `plugins`, the one way a host follows a list
 * that moves (the page on the families its server reports, the `kb ui`
 * server on the extensions its store has on): unload each top-level plugin
 * no longer listed, then load each listed one the kernel does not hold, in
 * order. Unloading takes everything the plugin registered with it, because
 * the kernel ties every contribution to the plugin's scope. A plugin that
 * fails either way is returned, and leaves nothing behind; the rest still
 * converge, so one broken extension never holds the others back.
 */
export const syncPlugins = Effect.fnUntraced(function* (
  kernel: Kernel,
  plugins: readonly Plugin[],
): Effect.fn.Return<readonly SyncFailure[]> {
  const failures: SyncFailure[] = [];
  const wanted = new Set(plugins.map((plugin) => plugin.name));
  for (const state of kernel.plugins()) {
    if (state.parent !== null || wanted.has(state.name)) continue;
    const exit = yield* Effect.exit(kernel.unload(state.name));
    if (Exit.isFailure(exit))
      failures.push({ name: state.name, verb: "unload", cause: exit.cause });
  }
  const held = new Set(kernel.plugins().map((state) => state.name));
  for (const plugin of plugins) {
    if (held.has(plugin.name)) continue;
    const exit = yield* Effect.exit(kernel.load(plugin));
    if (Exit.isFailure(exit)) failures.push({ name: plugin.name, verb: "load", cause: exit.cause });
  }
  return failures;
});
