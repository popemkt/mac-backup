import { Effect } from "effect";
import { ChannelPoint, UiHost, type KbContext, type UiHostService } from "@kb/contracts";
import { definePlugin, type Kernel, type Plugin } from "@kb/plugin";
import { receiptFromError } from "@kb/operations";
import { bunFileSystemLayer, manifest, writeErr } from "@kb/runtime";
import { serverInvoke } from "./invoke.ts";
import { serverRuntimeLayer, type ScreenHub } from "./screens.ts";
import type { ChannelDirectory } from "./session.ts";

/**
 * The `kb ui` server as a plugin host (`DESIGN.md` → Plugin channels). The
 * server is a composition like the browser's page: its own `@kb/plugin`
 * kernel, into which it provides {@link UiHost} and then loads the plugins
 * its caller names. It names none itself, so nothing here imports a plugin;
 * what the plugins contribute to {@link ChannelPoint} is what the socket hub
 * routes `channel` frames to.
 */

/** The channels `kernel` holds, read at each frame. */
export function channelsOf(kernel: Kernel): ChannelDirectory {
  return {
    find: (id) => kernel.lookup(ChannelPoint, id)?.value,
    all: () => kernel.contributions(ChannelPoint).map((contribution) => contribution.value),
  };
}

/** The server, as the service its plugins inject: the registry, run as every call is run here. */
function uiHost(ctx: KbContext, screens: ScreenHub): UiHostService {
  return {
    root: ctx.root,
    manifest: manifest(ctx.root).pipe(Effect.provide(bunFileSystemLayer)),
    invoke: (invocation) =>
      serverInvoke(ctx, invocation).pipe(
        Effect.provide(serverRuntimeLayer(ctx, screens)),
        Effect.catch((error) => Effect.succeed(receiptFromError(invocation.id, error))),
      ),
  };
}

/**
 * Provide the host into `kernel`, then load `plugins` in order. A plugin that
 * fails to load is reported and skipped, and so is one still waiting for a
 * service once all have loaded: neither stops the server, as an extension
 * that fails never stops core.
 */
export const loadServerPlugins = Effect.fn("kb.ui.loadPlugins")(function* (
  kernel: Kernel,
  ctx: KbContext,
  screens: ScreenHub,
  plugins: readonly Plugin[],
) {
  const host = uiHost(ctx, screens);
  // The host is the first thing a fresh kernel holds, so nothing can clash with it.
  yield* kernel
    .load(
      definePlugin({
        name: "ui-host",
        namespace: "",
        apply: (plugin) => plugin.provide(UiHost, host),
      }),
    )
    .pipe(Effect.orDie);
  for (const plugin of plugins) {
    yield* kernel
      .load(plugin)
      .pipe(
        Effect.catchTag("Kb/PluginError", (error) =>
          Effect.sync(() => writeErr(`kb ui: plugin ${plugin.name}: ${error.message} (skipped)`)),
        ),
      );
  }
  for (const state of kernel.plugins()) {
    if (state.status !== "pending") continue;
    writeErr(`kb ui: plugin ${state.name} waits for ${state.missing.join(", ")} (not loaded)`);
  }
});
