import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

const DEFAULT_HARNESS_PORT = 4323;

async function stop(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) return;
  if (!server.killed) server.kill("SIGTERM");
  await once(server, "exit");
}

/**
 * Spawn a harness UI over a throwaway copy of .kb.
 *
 * Any spec that writes needs its own instance. The store lives on the server
 * and persists for that server's lifetime, so one spec switching a renderer or
 * promoting a node changes what a later spec counts — which is exactly how a
 * passing spec makes an unrelated one fail. Ports are per-spec for isolation,
 * not for parallelism.
 */
export async function startHarness(port = DEFAULT_HARNESS_PORT): Promise<{
  url: string;
  stop: () => Promise<void>;
}> {
  const server = spawn("bun", ["tests-render/server.ts"], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: { ...process.env, KB_HARNESS_PORT: String(port) },
  });
  const url = `http://127.0.0.1:${port}`;

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/graph`);
      if (response.ok) return { url, stop: () => stop(server) };
    } catch {
      // The process needs a moment to load the data root and bind its port.
    }
    await delay(100);
  }
  await stop(server);
  throw new Error(`render harness UI did not start at ${url}`);
}
