import { watch, type FSWatcher } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { Effect, Exit, Fiber, Scope } from "effect";
import { FileSystem } from "effect/FileSystem";
import type { PlatformError } from "effect/PlatformError";
import { UI_DEFAULT_PORT, type KbContext } from "@kb/contracts";
import { currentIso, diffTx, type DomainError, domainError, ensureDomainError } from "@kb/model";
import { reloadEffect } from "@kb/operations";
import { kbRuntimeLayer, openKbEffect, writeErr } from "@kb/runtime";
import { bunFileSystemLayer } from "@kb/store-jsonl";
import { queriesDir } from "@kb/workspace-fs";
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
import { SavedQuerySet, listSavedQueriesEffect, savedQueryNodes } from "./saved-queries.ts";
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
 * Ingest an external write: bring the session up to date, then say what
 * changed.
 *
 * The store's tail is durable and shared, so a write another process made is
 * already recorded in it by the time this fires — `refresh` reads those
 * transactions rather than reconstructing them, which is both cheaper and the
 * only version that agrees with the writer about what happened. It doubles as
 * the double-fire guard: the watcher also fires on writes this session made,
 * and those are already at head.
 *
 * The diff is the fallback for a write nobody recorded — a hand-edited
 * `nodes.jsonl`, an older kb, a restore from backup. A file event carries no
 * transaction, only "something happened", so that case is the one place a
 * delta still has to be recovered by comparing node sets. It runs only when
 * the tail had nothing to say, because a change the tail already explained
 * would otherwise be recorded twice — once as the writer authored it and once
 * as this session re-derived it. An empty transaction is not appended either:
 * it costs a rev and a frame and says nothing.
 */
export const ingestExternalWrite = Effect.fn("kb.ingestExternalWrite")(function* (ctx: KbContext) {
  const before = ctx.index.storedNodes();
  yield* reloadEffect(ctx);
  // The tail explained the change, so nothing here has to guess at it.
  if (ctx.log.refresh().length > 0) return;
  const ops = diffTx(before, ctx.index.storedNodes());
  if (ops.upserts.length === 0 && ops.deletes.length === 0) return;
  ctx.log.append(ops, yield* currentIso);
});

/**
 * Ingest a change under `.kb/queries/`: re-list the saved queries and let the
 * virtual set record what moved.
 *
 * The saved-query sidebar is a projection of `.kb/queries/*.edn`, so the
 * directory is watched exactly the way the store's files are, and the change
 * reaches clients as the same kind of frame.
 */
export const ingestSavedQueries = Effect.fn("kb.ingestSavedQueries")(function* (
  root: string,
  queries: SavedQuerySet,
) {
  const saved = yield* listSavedQueriesEffect(root);
  queries.sync(savedQueryNodes(saved), yield* currentIso);
});

/** A debounce plus the way to cancel whatever it has in flight. */
interface Debounce {
  trigger: () => void;
  stop: () => void;
}

/**
 * Debounced fs-event ingest. Every event restarts a 50ms `Effect.sleep` in a
 * fresh fiber and interrupts the pending one, so a burst of writes is ingested
 * once. Owning a fiber rather than a `setTimeout` is what lets the server
 * scope cancel an in-flight ingest on stop.
 *
 * Two things are watched — the store's files and `.kb/queries/` — and they
 * differ only in what they run, so this takes the program rather than the
 * session: a second copy of the fiber bookkeeping is the thing to avoid here.
 */
function makeIngestDebounce(ingest: Effect.Effect<void, DomainError>): Debounce {
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
          yield* ingest;
        }).pipe(Effect.ignoreCause),
      );
    },
    stop: () => {
      stopped = true;
      cancel();
    },
  };
}

/**
 * One watched directory, and the filenames in it that matter — `null` when the
 * whole directory is the target.
 *
 * Directories rather than files because an atomic replacement strands a watch
 * on the old inode, so `nodes.jsonl` is watched as "the name `nodes.jsonl` in
 * `.kb`". `.kb/queries/` is the other kind of target: a saved query is added
 * and removed as a file, so what changes is the listing and every name in it
 * matters.
 */
interface WatchScope {
  directory: string;
  names: Set<string> | null;
}

/** The scopes that cover a set of files, one per containing directory. */
function fileScopes(paths: readonly string[]): WatchScope[] {
  const byDirectory = new Map<string, Set<string>>();
  for (const path of paths) {
    const directory = dirname(path);
    const names = byDirectory.get(directory) ?? new Set<string>();
    names.add(basename(path));
    byDirectory.set(directory, names);
  }
  return [...byDirectory].map(([directory, names]) => ({ directory, names }));
}

/**
 * Watch what the caller named. Best effort: an unwatchable directory simply
 * gets no live reload.
 *
 * The store is asked which files are its own rather than assumed. A JSONL
 * store is one file and a sqlite store is a database plus its write-ahead log;
 * an `if` here on which adapter the session got would put a backend's file
 * layout inside a package that is supposed to know only the port.
 */
function watchScopes(scopes: readonly WatchScope[], onEvent: () => void): FSWatcher[] {
  const watchers: FSWatcher[] = [];
  for (const { directory, names } of scopes) {
    try {
      const watcher = watch(directory, (_event, filename) => {
        if (names === null) {
          onEvent();
          return;
        }
        if (typeof filename !== "string" || filename === "" || names.has(filename)) onEvent();
      });
      watcher.on("error", () => {
        /* A transient filesystem error must not crash the server. */
      });
      watchers.push(watcher);
    } catch {
      /* Best effort for an unavailable directory. */
    }
  }
  return watchers;
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
 * routing, asset/static reads, hub message processing, publishing, and reload
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
  const hub = new SubscriptionHub(ctx);
  const queries = new SavedQuerySet(ctx);
  queries.adopt(savedQueryNodes(yield* listSavedQueriesEffect(opts.root)));

  const layer = kbRuntimeLayer(ctx);
  // The directory has to be there to be watched, and `kb ui` is the surface
  // that projects it — a root that has never saved a query would otherwise
  // never notice its first one.
  const savedDir = queriesDir(opts.root);
  yield* Effect.gen(function* () {
    const fs = yield* FileSystem;
    yield* fs.makeDirectory(savedDir, { recursive: true });
  }).pipe(Effect.ignoreCause);

  const lanes = [
    {
      scopes: fileScopes(ctx.store.watchPaths),
      ingest: ingestExternalWrite(ctx).pipe(Effect.provide(layer)),
    },
    {
      scopes: [{ directory: savedDir, names: null }],
      ingest: ingestSavedQueries(opts.root, queries).pipe(Effect.provide(layer)),
    },
  ].map(({ scopes, ingest }) => ({ scopes, debounce: makeIngestDebounce(ingest) }));
  const debounces = lanes.map((lane) => lane.debounce);
  const watchers = lanes.flatMap(({ scopes, debounce }) => watchScopes(scopes, debounce.trigger));
  const server = serveUi({ hostname, port, root: opts.root, ctx, hub });

  yield* Scope.addFinalizer(
    lifetime,
    Effect.sync(() => {
      for (const debounce of debounces) debounce.stop();
      for (const watcher of watchers) watcher.close();
      hub.dispose();
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
