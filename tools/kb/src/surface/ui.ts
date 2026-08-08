import { watch, type FSWatcher } from "node:fs";
import { access, constants, readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { openKb, reload, type KbContext } from "../context.ts";
import type { KbNode } from "../foundation/model.ts";
import { buildQueryDb, query } from "../foundation/query/index.ts";
import { invoke, manifest } from "../registry.ts";
import {
  ClientMessageSchema,
  GraphSnapshotSchema,
  UI_DEFAULT_PORT,
  WireNodeSchema,
  type GraphSnapshot,
  type ServerMessage,
  type WireNode,
} from "./protocol.ts";

const ActionInvocationSchema = z.object({
  id: z.string().min(1),
  input: z.unknown().optional(),
});

const KB_PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const UI_DIST = join(KB_PKG_ROOT, "ui", "dist");

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

type WsData = {
  clientId: string;
};

interface ClientState {
  ws: Bun.ServerWebSocket<WsData>;
  watchTx: boolean;
  /** subscription id → { query, lastHash } */
  subs: Map<string, { query: string; lastHash: string }>;
}

function toWireNode(node: KbNode): WireNode {
  return WireNodeSchema.parse(node);
}

function nodesToMap(nodes: KbNode[]): Map<string, KbNode> {
  return new Map(nodes.map((n) => [n.id, n]));
}

function contentHash(nodes: KbNode[]): string {
  const sorted = [...nodes].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  return String(Bun.hash(JSON.stringify(sorted)));
}

function rowsHash(rows: unknown[][]): string {
  return String(Bun.hash(JSON.stringify(rows)));
}

function normalizeRows(raw: unknown): unknown[][] {
  if (raw == null) return [];
  const list =
    raw instanceof Set
      ? [...raw]
      : Array.isArray(raw)
        ? raw
        : [];
  return list.map((r) => (Array.isArray(r) ? r : [r]));
}

function send(ws: Bun.ServerWebSocket<WsData>, msg: ServerMessage): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // client gone — ignore
  }
}

function diffNodes(
  oldMap: Map<string, KbNode>,
  newMap: Map<string, KbNode>,
): { upserts: WireNode[]; deletes: string[] } {
  const upserts: WireNode[] = [];
  const deletes: string[] = [];
  for (const [id, node] of newMap) {
    const prev = oldMap.get(id);
    if (!prev || JSON.stringify(prev) !== JSON.stringify(node)) {
      upserts.push(toWireNode(node));
    }
  }
  for (const id of oldMap.keys()) {
    if (!newMap.has(id)) deletes.push(id);
  }
  return { upserts, deletes };
}

class SubscriptionHub {
  rev = 0;
  private hash = "";
  private nodeMap = new Map<string, KbNode>();
  private clients = new Map<string, ClientState>();
  private ctx: KbContext;

  constructor(ctx: KbContext) {
    this.ctx = ctx;
    this.nodeMap = nodesToMap(ctx.nodes);
    this.hash = contentHash(ctx.nodes);
  }

  get snapshot(): GraphSnapshot {
    return GraphSnapshotSchema.parse({
      rev: this.rev,
      nodes: [...this.nodeMap.values()].map(toWireNode),
    });
  }

  addClient(ws: Bun.ServerWebSocket<WsData>): void {
    const id = ws.data.clientId;
    this.clients.set(id, { ws, watchTx: false, subs: new Map() });
    send(ws, { op: "hello", rev: this.rev });
  }

  removeClient(ws: Bun.ServerWebSocket<WsData>): void {
    this.clients.delete(ws.data.clientId);
  }

  handleMessage(ws: Bun.ServerWebSocket<WsData>, raw: string): void {
    const client = this.clients.get(ws.data.clientId);
    if (!client) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      send(ws, {
        op: "error",
        code: "invalid_json",
        message: "message is not valid JSON",
      });
      return;
    }

    const result = ClientMessageSchema.safeParse(parsed);
    if (!result.success) {
      send(ws, {
        op: "error",
        code: "invalid_message",
        message: result.error.issues.map((i) => i.message).join("; "),
      });
      return;
    }

    const msg = result.data;
    switch (msg.op) {
      case "ping":
        send(ws, { op: "pong" });
        break;
      case "watch-tx":
        client.watchTx = msg.enabled;
        break;
      case "unsubscribe":
        client.subs.delete(msg.id);
        break;
      case "subscribe": {
        try {
          const rows = normalizeRows(query(this.ctx.qdb, msg.query));
          const hash = rowsHash(rows);
          client.subs.set(msg.id, { query: msg.query, lastHash: hash });
          send(ws, { op: "rows", id: msg.id, rev: this.rev, rows });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          send(ws, {
            op: "error",
            id: msg.id,
            code: "query_error",
            message,
          });
        }
        break;
      }
    }
  }

  /**
   * Apply a new node set. No-ops when content hash matches (guards
   * action→fs.watch double-fire). Bumps rev, broadcasts tx + row updates.
   */
  applyNodes(nodes: KbNode[]): void {
    const hash = contentHash(nodes);
    if (hash === this.hash) return;

    const oldMap = this.nodeMap;
    const newMap = nodesToMap(nodes);
    const { upserts, deletes } = diffNodes(oldMap, newMap);

    this.nodeMap = newMap;
    this.hash = hash;
    this.rev += 1;

    this.ctx.nodes = nodes;
    this.ctx.qdb = buildQueryDb(nodes);

    if (upserts.length > 0 || deletes.length > 0) {
      const tx: ServerMessage = {
        op: "tx",
        rev: this.rev,
        upserts,
        deletes,
      };
      for (const c of this.clients.values()) {
        if (c.watchTx) send(c.ws, tx);
      }
    }

    this.pushSubscriptionRows();
  }

  private pushSubscriptionRows(): void {
    for (const c of this.clients.values()) {
      for (const [id, sub] of c.subs) {
        try {
          const rows = normalizeRows(query(this.ctx.qdb, sub.query));
          const hash = rowsHash(rows);
          if (hash === sub.lastHash) continue;
          sub.lastHash = hash;
          send(c.ws, { op: "rows", id, rev: this.rev, rows });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          send(c.ws, {
            op: "error",
            id,
            code: "query_error",
            message,
          });
        }
      }
    }
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function listSavedQueries(
  root: string,
): Promise<{ name: string; edn: string }[]> {
  const dir = join(root, ".kb", "queries");
  if (!(await pathExists(dir))) return [];
  const entries = await readdir(dir);
  const out: { name: string; edn: string }[] = [];
  for (const name of entries) {
    if (!name.endsWith(".edn")) continue;
    const edn = await readFile(join(dir, name), "utf8");
    out.push({ name: name.slice(0, -4), edn });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

async function serveStatic(
  pathname: string,
): Promise<Response | null> {
  if (!(await pathExists(join(UI_DIST, "index.html")))) {
    return null;
  }

  const rel =
    pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  const candidate = normalize(join(UI_DIST, rel));
  const distResolved = resolve(UI_DIST);
  if (
    candidate !== distResolved &&
    !candidate.startsWith(distResolved + "/")
  ) {
    return new Response("forbidden", { status: 403 });
  }

  if (await pathExists(candidate)) {
    const st = await stat(candidate);
    if (st.isFile()) {
      return new Response(Bun.file(candidate));
    }
  }

  // SPA fallback
  return new Response(Bun.file(join(UI_DIST, "index.html")));
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
  const hub = new SubscriptionHub(ctx);

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
        if (!filename || filename === "nodes.jsonl" || String(filename).endsWith("nodes.jsonl")) {
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

      try {
        if (url.pathname === "/api/graph" && req.method === "GET") {
          return Response.json(hub.snapshot);
        }

        if (url.pathname === "/api/manifest" && req.method === "GET") {
          return Response.json(manifest());
        }

        if (url.pathname === "/api/queries" && req.method === "GET") {
          const queries = await listSavedQueries(opts.root);
          return Response.json(queries);
        }

        if (url.pathname === "/api/action" && req.method === "POST") {
          let body: unknown;
          try {
            body = await req.json();
          } catch {
            return Response.json(
              {
                status: "failed",
                id: "unknown",
                code: "invalid_input",
                message: "request body must be JSON",
              },
              { status: 400 },
            );
          }

          const parsed = ActionInvocationSchema.safeParse(body);
          if (!parsed.success) {
            return Response.json(
              {
                status: "failed",
                id: "unknown",
                code: "invalid_input",
                message: parsed.error.issues.map((i) => i.message).join("; "),
              },
              { status: 400 },
            );
          }

          // Fresh load so we don't miss external writes, then invoke.
          await reload(ctx);
          const receipt = await invoke(ctx, {
            id: parsed.data.id,
            input: parsed.data.input ?? {},
          });
          // Immediate bump/broadcast — do not wait for fs.watch.
          hub.applyNodes(ctx.nodes);
          return Response.json(receipt);
        }

        if (
          url.pathname.startsWith("/api/") ||
          url.pathname === "/ws"
        ) {
          return new Response("not found", { status: 404 });
        }

        const staticResp = await serveStatic(url.pathname);
        if (staticResp) return staticResp;

        return Response.json(
          {
            error: "ui_not_built",
            message:
              "kb UI assets not found; build tools/kb/ui (ui/dist) or use the API/WS endpoints",
            hint: relative(process.cwd(), UI_DIST),
          },
          { status: 503 },
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return Response.json(
          { status: "failed", code: "internal", message },
          { status: 500 },
        );
      }
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

  return {
    port: server.port,
    url,
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

export { UI_DEFAULT_PORT, UI_DIST };
