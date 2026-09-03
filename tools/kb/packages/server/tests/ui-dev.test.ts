import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  runDevUntilExit,
  type UiDevChild,
  type UiDevSpawn,
  type UiDevSpawnOpts,
} from "../src/dev.ts";
import {
  startDevServer,
  startProductionUi,
  type UiDevServer,
} from "../src/server.ts";

/**
 * `kb ui --dev` / production-wiring tests. Deterministic: fake spawn child, no
 * browser, temp data roots only — the real Vite process is never launched and
 * the live checkout is never mutated.
 */

let roots: string[] = [];
let active: UiDevServer[] = [];

afterEach(async () => {
  for (const dev of active) await dev.stop().catch(() => {});
  active = [];
  for (const root of roots) await rm(root, { recursive: true, force: true });
  roots = [];
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(import.meta.dir, "kb-uidev-"));
  roots.push(root);
  await mkdir(join(root, ".kb", "queries"), { recursive: true });
  return root;
}

function deferredExit(): {
  promise: Promise<number | null>;
  resolve: (code: number | null) => void;
} {
  let resolve!: (code: number | null) => void;
  const promise = new Promise<number | null>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

interface FakeChildRec {
  child: UiDevChild;
  exit: ReturnType<typeof deferredExit>;
  killed: { killed: boolean };
}

function fakeChild(): FakeChildRec {
  const exit = deferredExit();
  const killed = { killed: false };
  return {
    killed,
    exit,
    child: {
      pid: 4242,
      kill: () => {
        killed.killed = true;
      },
      exited: exit.promise,
    },
  };
}

describe("kb ui --dev orchestration", () => {
  test("spawns vite dev on the requested port proxying to the backend port", async () => {
    const root = await tempRoot();
    const spawnCalls: UiDevSpawnOpts[] = [];
    const rec = fakeChild();
    const spawn: UiDevSpawn = (opts) => {
      spawnCalls.push(opts);
      return rec.child;
    };

    const dev = await startDevServer({
      root,
      backendPort: 0,
      devPort: 5173,
      uiRoot: "/tmp/fake-ui",
      spawn,
    });
    active.push(dev);

    expect(dev.url).toBe("http://127.0.0.1:5173");
    expect(spawnCalls).toHaveLength(1);
    const args = spawnCalls[0]!;
    expect(args.cmd).toBe("bun");
    expect(args.args).toEqual(["run", "dev", "--port", "5173"]);
    expect(args.cwd).toBe("/tmp/fake-ui");
    // Proxy target is the actual bound backend port (ephemeral 0 → real port).
    expect(args.env.KB_UI_API_PORT).toBe(String(dev.backend.port));

    // Backend is live on the bound port and serves the graph snapshot.
    const graph = await fetch(`http://127.0.0.1:${dev.backend.port}/api/graph`);
    expect(graph.status).toBe(200);

    // stop() kills the child and tears down the backend listener.
    await dev.stop();
    expect(rec.killed.killed).toBe(true);
    await expect(
      fetch(`http://127.0.0.1:${dev.backend.port}/api/graph`),
    ).rejects.toThrow();
  });

  test("backend port conflict fails fast with no orphaned listener", async () => {
    const root = await tempRoot();
    // Occupy a real port with a plain TCP listener (Bun.serve itself allows
    // re-binding via SO_REUSEPORT; an external process does not), then try to
    // start a dev backend on it.
    const { createServer } = await import("node:net");
    const blocker = createServer(() => {});
    await new Promise<void>((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(0, "127.0.0.1", () => resolve());
    });
    const boundPort = (blocker.address() as { port: number }).port;
    try {
      await expect(
        startDevServer({
          root,
          backendPort: boundPort,
          devPort: 5173,
          uiRoot: "/tmp/fake-ui",
          spawn: () => fakeChild().child,
        }),
      ).rejects.toThrow();
    } finally {
      blocker.close();
    }
  });

  test("runDevUntilExit stops the backend and reports the child exit code", async () => {
    const root = await tempRoot();
    const rec = fakeChild();
    const dev = await startDevServer({
      root,
      backendPort: 0,
      devPort: 5173,
      uiRoot: "/tmp/fake-ui",
      spawn: () => rec.child,
    });
    active.push(dev);

    const exits: (number | null)[] = [];
    const pending = runDevUntilExit(dev, (code) => exits.push(code));
    rec.exit.resolve(1);

    expect(await pending).toBe(1);
    expect(exits).toEqual([1]);
    // Backend torn down once the vite child is gone.
    await expect(
      fetch(`http://127.0.0.1:${dev.backend.port}/api/graph`),
    ).rejects.toThrow();
  });
});

describe("kb ui production wiring", () => {
  test("ensureBuilt runs before startUi and the server serves", async () => {
    const root = await tempRoot();
    const calls: string[] = [];
    const ensureBuilt = async () => {
      calls.push("ensure");
      return { built: true, state: "missing" as const };
    };

    const { handle, build } = await startProductionUi({
      root,
      port: 0,
      openBrowser: false,
      uiRoot: "/tmp/fake-ui",
      ensureBuilt,
    });

    expect(calls).toEqual(["ensure"]);
    expect(build).toEqual({ built: true, state: "missing" });
    const graph = await fetch(`http://127.0.0.1:${handle.port}/api/graph`);
    expect(graph.status).toBe(200);
    await handle.stop();
  });
});
