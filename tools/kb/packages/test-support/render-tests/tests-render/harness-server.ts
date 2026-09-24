import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const DEFAULT_HARNESS_PORT = 4323;

/**
 * The UI every harness instance serves: a Vite `test-render` build, the only
 * mode in which the renderers expose their internals (`__kbSigma`,
 * `__kbForceGraph`) to a spec. It is the harness's own output, never
 * `ui/dist`, so a spec cannot pass or fail on whichever production build — or
 * no build at all — happens to be lying there.
 */
const HARNESS_UI_DIST = resolve(import.meta.dirname, "../dist");

/** Build {@link HARNESS_UI_DIST} from the current UI source. Run once per suite. */
export function buildHarnessUi(): void {
  const build = spawnSync(
    "bun",
    [
      "run",
      "--filter",
      "@kb/ui",
      "build",
      "--mode",
      "test-render",
      "--outDir",
      HARNESS_UI_DIST,
      "--emptyOutDir",
    ],
    { cwd: process.cwd(), stdio: ["ignore", "ignore", "inherit"] },
  );
  if (build.status !== 0) {
    throw new Error(`render harness UI build failed (exit ${build.status ?? build.signal})`);
  }
}

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
  // The port travels as an argument. The served UI travels through the
  // server's own override, `KB_UI_DIST` (packages/app/server/src/paths.ts):
  // this process runs under Node, so it cannot import that Bun module to
  // name it, and the harness is the override's reason to exist.
  const server = spawn("bun", ["tests-render/server.ts", String(port)], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: { ...process.env, KB_UI_DIST: HARNESS_UI_DIST },
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
