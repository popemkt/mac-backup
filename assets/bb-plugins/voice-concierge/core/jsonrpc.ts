// A small JSON-RPC peer for `codex app-server`'s stdio protocol: one JSON object per line, requests carry an `id`,
// notifications do not, and the server may send its own requests (approvals, tool calls) that need an answer.
import type { Readable, Writable } from "node:stream";

export type Message = { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: { message?: string; code?: number } };

export class RpcError extends Error {
  readonly method: string;
  readonly code: number | undefined;
  constructor(method: string, message: string, code?: number) {
    super(`${method}: ${message}`);
    this.method = method;
    this.code = code;
  }
}

export interface Handlers {
  notification: (method: string, params: unknown) => void;
  /** Answer a server request; return the `result` object. */
  request: (method: string, params: unknown) => Promise<unknown> | unknown;
}

export class JsonRpcPeer {
  private nextId = 1;
  private buffer = "";
  private readonly pending = new Map<number, { method: string; resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private closed: Error | null = null;
  private readonly output: Writable;
  private readonly handlers: Handlers;

  constructor(input: Readable, output: Writable, handlers: Handlers) {
    this.output = output;
    this.handlers = handlers;
    input.setEncoding("utf8");
    input.on("data", (chunk: string) => this.feed(chunk));
    input.on("close", () => this.fail(new Error("codex app-server closed its output")));
  }

  feed(chunk: string): void {
    this.buffer += chunk;
    let i: number;
    while ((i = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, i).trim();
      this.buffer = this.buffer.slice(i + 1);
      if (line.length === 0) continue;
      let m: Message;
      try {
        m = JSON.parse(line) as Message;
      } catch {
        continue;
      }
      this.dispatch(m);
    }
  }

  private dispatch(m: Message): void {
    if (m.method === undefined && m.id !== undefined) {
      const p = this.pending.get(Number(m.id));
      if (p === undefined) return;
      this.pending.delete(Number(m.id));
      clearTimeout(p.timer);
      if (m.error !== undefined) p.reject(new RpcError(p.method, m.error.message ?? "request failed", m.error.code));
      else p.resolve(m.result);
      return;
    }
    if (m.method === undefined) return;
    if (m.id === undefined) {
      this.handlers.notification(m.method, m.params);
      return;
    }
    const id = m.id;
    Promise.resolve()
      .then(() => this.handlers.request(m.method!, m.params))
      .then(
        result => this.write({ id, result }),
        (e: unknown) => this.write({ id, error: { code: -32000, message: e instanceof Error ? e.message : String(e) } }),
      );
  }

  request<T = unknown>(method: string, params: unknown, timeoutMs = 30_000): Promise<T> {
    if (this.closed !== null) return Promise.reject(this.closed);
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RpcError(method, `no answer within ${Math.round(timeoutMs / 1000)} s`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve: v => resolve(v as T), reject, timer });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.write(params === undefined ? { method } : { method, params });
  }

  fail(error: Error): void {
    if (this.closed !== null) return;
    this.closed = error;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
  }

  get isClosed(): boolean {
    return this.closed !== null;
  }

  private write(m: Message): void {
    if (this.closed !== null) return;
    this.output.write(`${JSON.stringify(m)}\n`);
  }
}
