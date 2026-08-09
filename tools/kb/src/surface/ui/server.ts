import { watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { openKb, reload } from "../../context.ts";
import { UI_DEFAULT_PORT } from "../protocol.ts";
import { handleHttpRequest } from "./http.ts";
import { listSavedQueries, savedQueryNodes } from "./saved-queries.ts";
import { SubscriptionHub, type WsData } from "./session.ts";

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

/**
 * Start the `kb ui` HTTP+WS server. Binds 127.0.0.1 only.
 */
export async function startUi(opts: UiServerOptions): Promise<UiServerHandle> {
  const hostname = opts.hostname ?? "127.0.0.1";
  const port = opts.port ?? UI_DEFAULT_PORT;
  const openBrowserFlag = opts.openBrowser !== false;

  const ctx = await openKb(opts.root);
  const saved = await listSavedQueries(opts.root);
  const hub = new SubscriptionHub(ctx, savedQueryNodes(saved));

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let watcher: FSWatcher | null = null;
  let stopped = false;

  const onFsEvent = () => {
    if (stopped) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void (async () => {
        try {
          await reload(ctx);
          hub.applyNodes(ctx.nodes);
        } catch {
          // never crash the server on watch errors
        }
      })();
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
          !filename ||
          filename === "nodes.jsonl" ||
          String(filename).endsWith("nodes.jsonl")
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
        const clientId = crypto.randomUUID();
        const ok = srv.upgrade(req, { data: { clientId } });
        if (!ok) {
          return new Response("WebSocket upgrade failed", { status: 400 });
        }
        return undefined as unknown as Response;
      }

      return handleHttpRequest(req, { root: opts.root, ctx, hub });
    },
    websocket: {
      open(ws) {
        hub.addClient(ws);
      },
      message(ws, message) {
        const text =
          typeof message === "string"
            ? message
            : new TextDecoder().decode(message);
        hub.handleMessage(ws, text);
      },
      close(ws) {
        hub.removeClient(ws);
      },
    },
  });

  const url = `http://${hostname}:${server.port}`;
  if (openBrowserFlag) openBrowser(url);

  // server.port is `number | undefined` only for unix-socket listeners; we
  // always bind a TCP port, so it is defined here.
  const boundPort = server.port!;

  return {
    port: boundPort,
    url: `http://${hostname}:${boundPort}`,
    hostname,
    stop: async () => {
      stopped = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      watcher?.close();
      server.stop(true);
    },
  };
}

/**
 * CLI entry used by `kb ui`. Keeps the process alive until signal.
 */
export async function runUiCli(opts: {
  root: string;
  port?: number;
  openBrowser?: boolean;
}): Promise<void> {
  const handle = await startUi({
    root: opts.root,
    port: opts.port ?? UI_DEFAULT_PORT,
    openBrowser: opts.openBrowser !== false,
  });
  console.error(`kb ui listening on ${handle.url}`);
  await new Promise(() => {});
}
