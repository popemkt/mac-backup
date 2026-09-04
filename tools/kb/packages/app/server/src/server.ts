import { watch, type FSWatcher } from "node:fs";
import { join, relative } from "node:path";
import { Effect, Exit, Fiber, Scope } from "effect";
import type { FileSystem } from "effect/FileSystem";
import type { PlatformError } from "effect/PlatformError";
import { UI_DEFAULT_PORT, type KbContext } from "@kb/contracts";
import { type DomainError, domainError, ensureDomainError } from "@kb/model";
import { reloadEffect } from "@kb/operations";
import { kbRuntimeLayer, openKbEffect, writeErr } from "@kb/runtime";
import { bunFileSystemLayer } from "@kb/store-jsonl";
import { ensureUiBuilt, type UiBuildError, type UiEnsureResult } from "./build.ts";
import {
  UI_DEV_DEFAULT_PORT,
  bunSpawnDev,
  runDevUntilExit,
  type UiDevChild,
  type UiDevSpawn,
} from "./dev.ts";
import { childProcessEnv, UI_DIST, UI_ROOT } from "./paths.ts";
import { handleHttpRequest } from "./http.ts";
import { listSavedQueriesEffect, savedQueryNodes } from "./saved-queries.ts";
import { SubscriptionHub, type ClientSend, type WsData } from "./session.ts";

/** The injectable build-ensure step, shared by both entry points. */
export type EnsureUiBuilt = (
  uiRoot: string,
  distDir: string,
) => Effect.Effect<UiEnsureResult, PlatformError | UiBuildError, FileSystem>;

export interface UiServerOptions {
  root: string;
  /** Bind port; 0 = ephemeral. Default UI_DEFAULT_PORT. */
  port?: number;
  openBrowser?: boolean;
  hostname?: string;
}

export interface UiServerHandle {
  port: number;
  url: string;
  hostname: string;
  /** Close the scope that owns the listener, the watcher and the debounce. */
  stop: Effect.Effect<void>;
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  Bun.spawn(cmd, {
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
  });
}

function clientSend(ws: Bun.ServerWebSocket<WsData>): ClientSend {
  return (text) =>
    Effect.sync(() => {
      try {
        ws.send(text);
      } catch {
        // client gone — ignore
      }
    });
}

/**
 * Debounced store reload. Every fs event restarts a 50ms `Effect.sleep` in a
 * fresh fiber and interrupts the pending one, so a burst of writes reloads
 * once. Owning a fiber rather than a `setTimeout` is what lets the server
 * scope cancel an in-flight reload on stop.
 */
function makeReloadDebounce(
  ctx: KbContext,
  hub: SubscriptionHub,
): { trigger: () => void; stop: () => void } {
  let pending: Fiber.Fiber<void> | null = null;
  let stopped = false;

  const cancel = (): void => {
    if (pending === null) return;
    Effect.runFork(Fiber.interrupt(pending));
    pending = null;
  };

  return {
    trigger: () => {
      if (stopped) return;
      cancel();
      pending = Effect.runFork(
        Effect.gen(function* () {
          yield* Effect.sleep("50 millis");
          yield* reloadEffect(ctx);
          yield* hub.applyNodes(ctx.nodes);
        }).pipe(Effect.provide(kbRuntimeLayer(ctx)), Effect.ignoreCause),
      );
    },
    stop: () => {
      stopped = true;
      cancel();
    },
  };
}

/**
 * Watch `.kb/nodes.jsonl`, falling back to its directory when the file does
 * not exist yet. Best effort: an unwatchable root simply gets no live reload.
 */
function watchNodesFile(root: string, onEvent: () => void): FSWatcher | null {
  try {
    return watch(join(root, ".kb", "nodes.jsonl"), onEvent);
  } catch {
    // file may not exist yet — watch the .kb dir instead
  }
  try {
    return watch(join(root, ".kb"), (_event, filename) => {
      if (
        typeof filename !== "string" ||
        filename === "" ||
        filename === "nodes.jsonl" ||
        filename.endsWith("nodes.jsonl")
      ) {
        onEvent();
      }
    });
  } catch {
    return null; // best-effort
  }
}

/**
 * The Bun.serve boundary. Bun owns the TCP listen, the WebSocket upgrade and
 * response delivery; every callback here forks or returns one Effect against
 * the layers the caller already built.
 */
function serveUi(deps: {
  hostname: string;
  port: number;
  root: string;
  ctx: KbContext;
  hub: SubscriptionHub;
}): Bun.Server<WsData> {
  const { ctx, hub } = deps;
  return Bun.serve<WsData>({
    hostname: deps.hostname,
    port: deps.port,
    fetch(req, srv) {
      const url = new URL(req.url);

      if (url.pathname === "/ws" && req.method === "GET") {
        const origin = url.searchParams.get("origin");
        const clientId = origin !== null && origin !== "" ? origin : crypto.randomUUID();
        const ok = srv.upgrade(req, { data: { clientId } });
        if (!ok) {
          return new Response("WebSocket upgrade failed", { status: 400 });
        }
        return undefined;
      }

      return handleHttpRequest(req, { root: deps.root, ctx, hub });
    },
    websocket: {
      open(ws) {
        Effect.runFork(hub.addClient(ws.data.clientId, clientSend(ws)));
      },
      message(ws, message) {
        const text = typeof message === "string" ? message : new TextDecoder().decode(message);
        Effect.runFork(hub.handleMessage(ws.data.clientId, text));
      },
      close(ws) {
        Effect.runFork(hub.removeClient(ws.data.clientId));
      },
    },
  });
}

/**
 * Start the `kb ui` HTTP+WS server.
 *
 * Single Bun.serve / Effect runtime boundary: `Bun.serve` owns the TCP listen,
 * WebSocket upgrade, and response delivery (`Bun.file` bodies). Request
 * routing, asset/static reads, hub message processing, broadcast, and reload
 * are Effect programs provided with FileSystem/KbStore layers. Binds
 * 127.0.0.1 only by default.
 */
export const startUi = Effect.fn("kb.startUi")(function* (
  opts: UiServerOptions,
): Effect.fn.Return<UiServerHandle, DomainError, FileSystem> {
  const hostname = opts.hostname ?? "127.0.0.1";
  const port = opts.port ?? UI_DEFAULT_PORT;
  const openBrowserFlag = opts.openBrowser !== false;

  const lifetime = Scope.makeUnsafe("parallel");

  const ctx = yield* openKbEffect(opts.root);
  const saved = yield* listSavedQueriesEffect(opts.root);
  const hub = new SubscriptionHub(ctx, savedQueryNodes(saved));

  const reload = makeReloadDebounce(ctx, hub);
  const watcher = watchNodesFile(opts.root, reload.trigger);
  const server = serveUi({ hostname, port, root: opts.root, ctx, hub });

  yield* Scope.addFinalizer(
    lifetime,
    Effect.sync(() => {
      reload.stop();
      watcher?.close();
      void server.stop(true);
    }),
  );

  const url = `http://${hostname}:${server.port}`;
  if (openBrowserFlag) openBrowser(url);

  // server.port is `number | undefined` only for unix-socket listeners; we
  // always bind a TCP port, so it is defined here.
  const boundPort = server.port;
  if (boundPort === undefined) {
    return yield* domainError("internal", "TCP listener missing port");
  }

  return {
    port: boundPort,
    url: `http://${hostname}:${boundPort}`,
    hostname,
    stop: Scope.close(lifetime, Exit.void),
  };
}, Effect.provide(bunFileSystemLayer));

export interface UiDevServer {
  backend: UiServerHandle;
  child: UiDevChild;
  /** Browser URL for the Vite dev server. */
  url: string;
  /** Kill the Vite child and stop the backend listener. */
  stop: Effect.Effect<void>;
}

/**
 * `kb ui --dev`: the kb backend plus a Vite dev child that proxies /api,
 * /assets and /ws back to it (HMR on the Vite port). Fails fast — stopping
 * the backend — if either cannot come up (e.g. backend port already bound).
 */
export const startDevServer = Effect.fn("kb.startDevServer")(function* (opts: {
  root: string;
  backendPort: number;
  devPort: number;
  uiRoot: string;
  spawn?: UiDevSpawn;
}): Effect.fn.Return<UiDevServer, DomainError, FileSystem> {
  const backend = yield* startUi({
    root: opts.root,
    port: opts.backendPort,
    openBrowser: false,
  });
  const spawn = opts.spawn ?? bunSpawnDev;
  const child = yield* Effect.try({
    try: () =>
      spawn({
        cmd: "bun",
        args: ["run", "dev", "--port", String(opts.devPort)],
        cwd: join(opts.uiRoot),
        env: childProcessEnv({
          // Vite proxy target: /api, /assets, /ws all route to the kb backend.
          KB_UI_API_PORT: String(backend.port),
        }),
      }),
    catch: ensureDomainError,
  }).pipe(Effect.tapError(() => backend.stop));
  return {
    backend,
    child,
    url: `http://127.0.0.1:${opts.devPort}`,
    stop: Effect.sync(() => {
      child.kill();
    }).pipe(Effect.andThen(backend.stop)),
  };
}, Effect.provide(bunFileSystemLayer));

/**
 * Production lifecycle: ensure the built UI is present and fresh, then serve.
 * The build step is injectable for tests (fake runner, no live checkout).
 */
export const startProductionUi = Effect.fn("kb.startProductionUi")(function* (opts: {
  root: string;
  port: number;
  openBrowser: boolean;
  uiRoot: string;
  ensureBuilt?: EnsureUiBuilt;
}): Effect.fn.Return<{ handle: UiServerHandle; build: UiEnsureResult }, DomainError, FileSystem> {
  const ensure = opts.ensureBuilt ?? ensureUiBuilt;
  const build = yield* ensure(opts.uiRoot, UI_DIST).pipe(Effect.mapError(ensureDomainError));
  const handle = yield* startUi({
    root: opts.root,
    port: opts.port,
    openBrowser: opts.openBrowser,
  });
  return { handle, build };
}, Effect.provide(bunFileSystemLayer));

/** Stop on SIGINT/SIGTERM; the returned function detaches on the normal path. */
function onTerminationSignal(stop: Effect.Effect<void>): () => void {
  const handler = (): void => {
    Effect.runFork(stop);
    process.exit(0);
  };
  process.once("SIGINT", handler);
  process.once("SIGTERM", handler);
  return () => {
    process.off("SIGINT", handler);
    process.off("SIGTERM", handler);
  };
}

export interface RunUiCliOptions {
  root: string;
  port?: number;
  openBrowser?: boolean;
  dev?: boolean;
  devPort?: number;
  uiRoot?: string;
  /** Injectable build-ensure step (default {@link ensureUiBuilt}). */
  ensureBuilt?: EnsureUiBuilt;
  spawnDev?: UiDevSpawn;
}

/**
 * CLI entry used by `kb ui`. Production auto-builds `ui/dist` when required
 * (missing or stale), then serves it; `--dev` spawns the Vite dev server and
 * proxies to the kb backend. Stays alive until signal (production) or the Vite
 * child exits (dev).
 */
export const runUiCli = Effect.fn("kb.runUiCli")(function* (
  opts: RunUiCliOptions,
): Effect.fn.Return<never, DomainError, FileSystem> {
  const open = opts.openBrowser !== false;
  const uiRoot = opts.uiRoot ?? UI_ROOT;

  if (opts.dev === true) {
    const devPort = opts.devPort ?? UI_DEV_DEFAULT_PORT;
    const dev = yield* startDevServer({
      root: opts.root,
      backendPort: opts.port ?? UI_DEFAULT_PORT,
      devPort,
      uiRoot,
      spawn: opts.spawnDev,
    });
    writeErr(`kb ui dev server listening on ${dev.url}`);
    if (open) openBrowser(dev.url);

    const detachSignals = onTerminationSignal(dev.stop);

    const code = yield* runDevUntilExit(dev, (exitCode) => {
      detachSignals();
      if (exitCode !== 0 && exitCode !== null) {
        writeErr(`kb ui: vite dev server exited with code ${exitCode}`);
      }
    });
    process.exit(code === 0 ? 0 : 1);
  }

  const { build, handle } = yield* startProductionUi({
    root: opts.root,
    port: opts.port ?? UI_DEFAULT_PORT,
    openBrowser: open,
    uiRoot,
    ensureBuilt: opts.ensureBuilt,
  });
  if (build.built) {
    writeErr(`kb ui: built UI at ${relative(process.cwd(), UI_DIST)} (${build.state})`);
  }
  writeErr(`kb ui listening on ${handle.url}`);
  // The listener owns the process from here; the scope closes on signal.
  return yield* Effect.never;
}, Effect.provide(bunFileSystemLayer));
