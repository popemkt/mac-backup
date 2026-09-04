import { watch, type FSWatcher } from "node:fs";
import { join, relative } from "node:path";
import { Effect, Exit, Scope } from "effect";
import { UI_DEFAULT_PORT } from "@kb/contracts";
import { reloadEffect } from "@kb/operations";
import { kbRuntimeLayer, openKbEffect, writeErr } from "@kb/runtime";
import { bunFileSystemLayer } from "@kb/store-jsonl";
import { ensureUiBuilt, type UiEnsureResult } from "./build.ts";
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
  stop: () => Promise<void>;
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
 * Start the `kb ui` HTTP+WS server.
 *
 * Single Bun.serve / Effect runtime boundary: `Bun.serve` owns the TCP listen,
 * WebSocket upgrade, and response delivery (`Bun.file` bodies). Request
 * routing, asset/static reads, hub message processing, broadcast, and reload
 * are Effect programs provided with FileSystem/KbStore layers. Binds
 * 127.0.0.1 only by default.
 */
export async function startUi(opts: UiServerOptions): Promise<UiServerHandle> {
  const hostname = opts.hostname ?? "127.0.0.1";
  const port = opts.port ?? UI_DEFAULT_PORT;
  const openBrowserFlag = opts.openBrowser !== false;

  const lifetime = Scope.makeUnsafe("parallel");

  const { ctx, hub } = await Effect.runPromise(
    Effect.gen(function* () {
      const opened = yield* openKbEffect(opts.root);
      const saved = yield* listSavedQueriesEffect(opts.root);
      return { ctx: opened, hub: new SubscriptionHub(opened, savedQueryNodes(saved)) };
    }).pipe(Effect.provide(bunFileSystemLayer)),
  );

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let watcher: FSWatcher | null = null;
  let stopped = false;

  const onFsEvent = () => {
    if (stopped) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      Effect.runFork(
        Effect.gen(function* () {
          yield* reloadEffect(ctx);
          yield* hub.applyNodes(ctx.nodes);
        }).pipe(
          Effect.provide(kbRuntimeLayer(ctx)),
          Effect.catchCause(() => Effect.void),
        ),
      );
    }, 50);
  };

  const nodesPath = join(opts.root, ".kb", "nodes.jsonl");
  try {
    watcher = watch(nodesPath, onFsEvent);
  } catch {
    // file may not exist yet — watch the .kb dir instead
    try {
      watcher = watch(join(opts.root, ".kb"), (_event, filename) => {
        if (
          typeof filename !== "string" ||
          filename === "" ||
          filename === "nodes.jsonl" ||
          filename.endsWith("nodes.jsonl")
        ) {
          onFsEvent();
        }
      });
    } catch {
      // best-effort
    }
  }

  const server = Bun.serve<WsData>({
    hostname,
    port,
    async fetch(req, srv) {
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

      return handleHttpRequest(req, { root: opts.root, ctx, hub });
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

  await Effect.runPromise(
    Scope.addFinalizer(
      lifetime,
      Effect.sync(() => {
        stopped = true;
        if (debounceTimer) clearTimeout(debounceTimer);
        watcher?.close();
        void server.stop(true);
      }),
    ),
  );

  const url = `http://${hostname}:${server.port}`;
  if (openBrowserFlag) openBrowser(url);

  // server.port is `number | undefined` only for unix-socket listeners; we
  // always bind a TCP port, so it is defined here.
  const boundPort = server.port;
  if (boundPort === undefined) {
    throw new Error("TCP listener missing port");
  }

  return {
    port: boundPort,
    url: `http://${hostname}:${boundPort}`,
    hostname,
    stop: async () => {
      await Effect.runPromise(Scope.close(lifetime, Exit.void));
    },
  };
}

export interface UiDevServer {
  backend: UiServerHandle;
  child: UiDevChild;
  /** Browser URL for the Vite dev server. */
  url: string;
  /** Kill the Vite child and stop the backend listener. */
  stop: () => Promise<void>;
}

/**
 * `kb ui --dev`: the kb backend plus a Vite dev child that proxies /api,
 * /assets and /ws back to it (HMR on the Vite port). Fails fast — stopping
 * the backend — if either cannot come up (e.g. backend port already bound).
 */
export async function startDevServer(opts: {
  root: string;
  backendPort: number;
  devPort: number;
  uiRoot: string;
  spawn?: UiDevSpawn;
}): Promise<UiDevServer> {
  const backend = await startUi({
    root: opts.root,
    port: opts.backendPort,
    openBrowser: false,
  });
  try {
    const spawn = opts.spawn ?? bunSpawnDev;
    const child = spawn({
      cmd: "bun",
      args: ["run", "dev", "--port", String(opts.devPort)],
      cwd: join(opts.uiRoot),
      env: childProcessEnv({
        // Vite proxy target: /api, /assets, /ws all route to the kb backend.
        KB_UI_API_PORT: String(backend.port),
      }),
    });
    return {
      backend,
      child,
      url: `http://127.0.0.1:${opts.devPort}`,
      stop: async () => {
        child.kill();
        await backend.stop();
      },
    };
  } catch (err) {
    await backend.stop();
    throw err;
  }
}

/**
 * Production lifecycle: ensure the built UI is present and fresh, then serve.
 * The build step is injectable for tests (fake runner, no live checkout).
 */
export async function startProductionUi(opts: {
  root: string;
  port: number;
  openBrowser: boolean;
  uiRoot: string;
  ensureBuilt?: (uiRoot: string, distDir: string) => Promise<UiEnsureResult>;
}): Promise<{ handle: UiServerHandle; build: UiEnsureResult }> {
  const ensure = opts.ensureBuilt ?? ensureUiBuilt;
  const build = await ensure(opts.uiRoot, UI_DIST);
  const handle = await startUi({
    root: opts.root,
    port: opts.port,
    openBrowser: opts.openBrowser,
  });
  return { handle, build };
}

export interface RunUiCliOptions {
  root: string;
  port?: number;
  openBrowser?: boolean;
  dev?: boolean;
  devPort?: number;
  uiRoot?: string;
  /** Injectable build-ensure step (default {@link ensureUiBuilt}). */
  ensureBuilt?: (uiRoot: string, distDir: string) => Promise<UiEnsureResult>;
  spawnDev?: UiDevSpawn;
}

/**
 * CLI entry used by `kb ui`. Production auto-builds `ui/dist` when required
 * (missing or stale), then serves it; `--dev` spawns the Vite dev server and
 * proxies to the kb backend. Stays alive until signal (production) or the Vite
 * child exits (dev).
 */
export async function runUiCli(opts: RunUiCliOptions): Promise<void> {
  const open = opts.openBrowser !== false;
  const uiRoot = opts.uiRoot ?? UI_ROOT;

  if (opts.dev === true) {
    const devPort = opts.devPort ?? UI_DEV_DEFAULT_PORT;
    const dev = await startDevServer({
      root: opts.root,
      backendPort: opts.port ?? UI_DEFAULT_PORT,
      devPort,
      uiRoot,
      spawn: opts.spawnDev,
    });
    writeErr(`kb ui dev server listening on ${dev.url}`);
    if (open) openBrowser(dev.url);

    const onSignal = () => {
      void dev.stop();
      process.exit(0);
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);

    const code = await runDevUntilExit(dev, (exitCode) => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      if (exitCode !== 0 && exitCode !== null) {
        writeErr(`kb ui: vite dev server exited with code ${exitCode}`);
      }
    });
    process.exit(code === 0 ? 0 : 1);
  }

  const { build, handle } = await startProductionUi({
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
  await new Promise(() => {});
}
