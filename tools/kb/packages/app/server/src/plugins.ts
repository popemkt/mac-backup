import { Cause, Effect, Semaphore } from "effect";
import {
  ChannelPoint,
  UiHost,
  extensionNodeId,
  extensionRow,
  familyOn,
  type ExtensionEntry,
  type ExtensionRow,
  type KbContext,
  type UiHostService,
} from "@kb/contracts";
import { definePlugin, syncPlugins, type Kernel } from "@kb/plugin";
import { receiptFromError } from "@kb/operations";
import { writeErr } from "@kb/runtime";
import { serverInvoke } from "./invoke.ts";
import { serverRuntimeLayer, type ScreenHub } from "./screens.ts";
import type { ChannelDirectory } from "./session.ts";

/**
 * The `kb ui` server as a plugin host (`DESIGN.md` → Plugin channels). The
 * server is a composition like the browser's page: its own `@kb/plugin`
 * kernel, into which it provides {@link UiHost} and then loads the
 * extensions its caller names, each while its store has it on. It names none
 * itself, so nothing here imports a plugin; what the plugins contribute to
 * {@link ChannelPoint} is what the socket hub routes `channel` frames to, and
 * each extension it was handed is reported beside the registry's
 * ({@link HostedExtensions}).
 */

/** The channels `kernel` holds, read at each frame. */
export function channelsOf(kernel: Kernel): ChannelDirectory {
  return {
    find: (id) => kernel.lookup(ChannelPoint, id)?.value,
    all: () => kernel.contributions(ChannelPoint).map((contribution) => contribution.value),
  };
}

/**
 * The extensions the server was handed, composed as its store switches them
 * (`familyOn`, the one decision every host makes): `converge` loads each one
 * the store has on and unloads each one it has off, through `syncPlugins`;
 * `rows` converges, then reports each one's row, enabled while the kernel
 * holds its plugin active. Converging before a report means a switch the
 * store holds is what the server reports, whoever wrote it and however the
 * server heard of it.
 */
interface HostedExtensions {
  readonly converge: Effect.Effect<void>;
  readonly rows: Effect.Effect<readonly ExtensionRow[]>;
  /** The switch nodes of the extensions it was handed: a write to one is a reason to converge. */
  readonly switches: ReadonlySet<string>;
}

/** How the server says a family's switch could not be read. */
function unreadSwitch(name: string): (warning: string) => void {
  return (warning) => writeErr(`kb ui: extension switch ${name}: ${warning} (read as its default)`);
}

/** The server, as the service its plugins inject: the registry, run as every call is run here. */
function uiHost(
  ctx: KbContext,
  screens: ScreenHub,
  hosted: Effect.Effect<readonly ExtensionRow[]>,
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
 * Provide the host into `kernel`, then compose each extension the store has
 * on, in order. A plugin that fails to load is reported and skipped, and so
 * is one still waiting for a service: neither stops the server, as an
 * extension that fails never stops core. Returns how the server keeps them
 * composed and reports them ({@link HostedExtensions}).
 */
export const loadServerPlugins = Effect.fn("kb.ui.loadPlugins")(function* (
  kernel: Kernel,
  ctx: KbContext,
  screens: ScreenHub,
  extensions: readonly ExtensionEntry[],
) {
  const lock = yield* Semaphore.make(1);
  const nodeOf = (id: string) => ctx.index.getNode(id);
  const rows: Effect.Effect<readonly ExtensionRow[]> = Effect.suspend(() => converge).pipe(
    Effect.andThen(
      Effect.sync(() => {
        const active = new Set(
          kernel
            .plugins()
            .filter((state) => state.status === "active")
            .map((state) => state.name),
        );
        return extensions.map(({ declaration, entry }) =>
          extensionRow(declaration, "host", active.has(entry.name)),
        );
      }),
    ),
  );
  // The host is the first thing the kernel holds, and it is held whatever the store says.
  const host = definePlugin({
    name: "ui-host",
    namespace: "",
    apply: (plugin) => plugin.provide(UiHost, uiHost(ctx, screens, rows)),
  });
  // The names composed last: the kernel moves only when the store's switches do, so a
  // plugin that failed is tried again when it is switched, not at every report.
  let composed: string | null = null;
  const converge: Effect.Effect<void> = lock.withPermit(
    Effect.gen(function* () {
      const on = extensions.filter(({ declaration }) =>
        familyOn(declaration, nodeOf, unreadSwitch(declaration.name)),
      );
      const names = on.map(({ declaration }) => declaration.name).join("\0");
      if (names === composed) return;
      composed = names;
      const failures = yield* syncPlugins(kernel, [host, ...on.map(({ entry }) => entry)]);
      for (const { name, verb, cause } of failures) {
        const failure = Cause.squash(cause);
        const why = failure instanceof Error ? failure.message : String(failure);
        writeErr(`kb ui: plugin ${name}: failed to ${verb}: ${why} (skipped)`);
      }
      for (const state of kernel.plugins()) {
        if (state.status !== "pending") continue;
        writeErr(`kb ui: plugin ${state.name} waits for ${state.missing.join(", ")} (not loaded)`);
      }
    }),
  );
  yield* converge;
  return {
    converge,
    rows,
    switches: new Set(extensions.map(({ declaration }) => extensionNodeId(declaration.name))),
  } satisfies HostedExtensions;
});
