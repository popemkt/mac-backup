import { Effect } from "effect";
import {
  ChannelPoint,
  UiHost,
  extensionRow,
  type ExtensionEntry,
  type ExtensionRow,
  type KbContext,
  type UiHostService,
} from "@kb/contracts";
import { definePlugin, type Kernel } from "@kb/plugin";
import { receiptFromError } from "@kb/operations";
import { writeErr } from "@kb/runtime";
import { serverInvoke } from "./invoke.ts";
import { serverRuntimeLayer, type ScreenHub } from "./screens.ts";
import type { ChannelDirectory } from "./session.ts";

/**
 * The `kb ui` server as a plugin host (`DESIGN.md` → Plugin channels). The
 * server is a composition like the browser's page: its own `@kb/plugin`
 * kernel, into which it provides {@link UiHost} and then loads the
 * extensions its caller names. It names none itself, so nothing here imports
 * a plugin; what the plugins contribute to {@link ChannelPoint} is what the
 * socket hub routes `channel` frames to, and each extension it was handed is
 * reported beside the registry's ({@link hostedRows}).
 */

/** The channels `kernel` holds, read at each frame. */
export function channelsOf(kernel: Kernel): ChannelDirectory {
  return {
    find: (id) => kernel.lookup(ChannelPoint, id)?.value,
    all: () => kernel.contributions(ChannelPoint).map((contribution) => contribution.value),
  };
}

/**
 * The extensions the server was handed, as `kb.manifest` reports them: each
 * one's row, enabled while the kernel holds its plugin loaded. Read at each
 * call, so a plugin that failed or still waits reads as not loaded.
 */
function hostedRows(
  kernel: Kernel,
  extensions: readonly ExtensionEntry[],
): () => readonly ExtensionRow[] {
  return () => {
    const loaded = new Set(
      kernel
        .plugins()
        .filter((state) => state.status === "active")
        .map((state) => state.name),
    );
    return extensions.map(({ declaration, entry }) =>
      extensionRow(declaration, "host", loaded.has(entry.name)),
    );
  };
}

/** The server, as the service its plugins inject: the registry, run as every call is run here. */
function uiHost(
  ctx: KbContext,
  screens: ScreenHub,
  hosted: () => readonly ExtensionRow[],
): UiHostService {
  return {
    root: ctx.root,
    invoke: (invocation) =>
      serverInvoke(ctx, invocation).pipe(
        Effect.provide(serverRuntimeLayer(ctx, screens, hosted)),
        Effect.catch((error) => Effect.succeed(receiptFromError(invocation.id, error))),
      ),
  };
}

/**
 * Provide the host into `kernel`, then load each extension's plugin in
 * order. A plugin that fails to load is reported and skipped, and so is one
 * still waiting for a service once all have loaded: neither stops the
 * server, as an extension that fails never stops core. Returns how the
 * server reports them ({@link hostedRows}).
 */
export const loadServerPlugins = Effect.fn("kb.ui.loadPlugins")(function* (
  kernel: Kernel,
  ctx: KbContext,
  screens: ScreenHub,
  extensions: readonly ExtensionEntry[],
) {
  const hosted = hostedRows(kernel, extensions);
  const host = uiHost(ctx, screens, hosted);
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
  for (const { entry: plugin } of extensions) {
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
  return hosted;
});
