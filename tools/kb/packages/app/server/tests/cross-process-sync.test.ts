/**
 * Live sync across processes: a running `kb ui`, a `kb add` from a second
 * process, and the write reaching the UI's watchers as a `tx` frame.
 *
 * Everything else under this directory drives `ingestExternalWrite` by hand,
 * which proves the ingest and never the trigger. The trigger depends on what
 * the platform reports: on macOS an atomic replace (`tmp` → `nodes.jsonl`) is
 * reported under the temp name, and a burst coalesces to whichever single name
 * the platform picked, so a watcher that trusted event filenames would miss
 * every JSONL commit. Only a real second process, writing the way the CLI
 * writes, exercises that — for each backend, because each writes its files
 * differently.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { ServerMessage } from "@kb/contracts";
import { startUi, type UiServerHandle } from "../src/index.ts";

const CLI = join(import.meta.dir, "..", "..", "cli", "src", "main.ts");

/** Generous next to the 50ms debounce: the bound is "live", not "fast". */
const FRAME_TIMEOUT_MS = 5000;

type TxFrame = Extract<ServerMessage, { op: "tx" }>;

async function kb(root: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(["bun", CLI, "--root", root, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`kb ${args.join(" ")} exited ${code}: ${err}`);
  return out;
}

/** A client opted into tx broadcasts, with every frame it has received. */
async function watchingClient(port: number): Promise<{ ws: WebSocket; frames: ServerMessage[] }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const frames: ServerMessage[] = [];
  ws.addEventListener("message", (ev) => {
    frames.push(JSON.parse(String(ev.data)) as ServerMessage);
  });
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("ws open failed")));
  });
  ws.send(JSON.stringify({ op: "watch-tx", enabled: true }));
  return { ws, frames };
}

async function txFrameMatching(
  frames: ServerMessage[],
  text: string,
): Promise<TxFrame | undefined> {
  const deadline = Date.now() + FRAME_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const hit = frames.find(
      (f): f is TxFrame => f.op === "tx" && f.upserts.some((n) => n.text === text),
    );
    if (hit !== undefined) return hit;
    await Bun.sleep(25);
  }
  return undefined;
}

async function graphRev(handle: UiServerHandle): Promise<number> {
  const res = await fetch(`${handle.url}/api/graph`);
  return ((await res.json()) as { rev: number }).rev;
}

describe.each(["jsonl", "sqlite"] as const)("a %s store", (store) => {
  let root = "";
  let handle: UiServerHandle | null = null;
  let ws: WebSocket | null = null;

  afterEach(async () => {
    ws?.close();
    ws = null;
    if (handle !== null) await Effect.runPromise(handle.stop);
    handle = null;
    await rm(root, { recursive: true, force: true });
  });

  test(
    "a CLI write from another process reaches a running server as a tx frame",
    async () => {
      root = await mkdtemp(join(tmpdir(), `kb-cross-process-${store}-`));
      await kb(root, "init", "--store", store, "--bare");
      handle = await Effect.runPromise(startUi({ root, port: 0, openBrowser: false }));
      const client = await watchingClient(handle.port);
      ws = client.ws;
      const before = await graphRev(handle);

      await kb(root, "add", "written by another process");
      const first = await txFrameMatching(client.frames, "written by another process");
      expect(first).toBeDefined();
      expect(first?.rev).toBeGreaterThan(before);
      expect(await graphRev(handle)).toBe(first?.rev ?? -1);

      // The second write is the one a stale watch would miss: the first
      // replaced the file the watch was opened on.
      await kb(root, "add", "and again");
      const second = await txFrameMatching(client.frames, "and again");
      expect(second).toBeDefined();
      expect(second?.rev).toBeGreaterThan(first?.rev ?? Infinity);
    },
    3 * FRAME_TIMEOUT_MS + 10_000,
  );
});
