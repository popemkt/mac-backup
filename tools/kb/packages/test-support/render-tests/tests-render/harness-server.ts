import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/**
 * The UI every harness instance serves: a Vite `test-render` build, the only
 * mode in which the renderers expose their internals (`__kbSigma`,
 * `__kbForce3d`) to a spec. It is the harness's own output, never
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

/** A port nothing is bound to right now, as the OS hands it out. */
async function freePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  probe.close();
  await once(probe, "close");
  if (address === null || typeof address === "string") throw new Error("no free port");
  return address.port;
}

/**
 * Spawn a harness UI over a fresh fixture store (`server.ts`).
 *
 * Every test gets its own instance, through the `harness` fixture in
 * `harness-test.ts`. The store lives on the server for that server's
 * lifetime, so a test that switches a renderer or promotes a node would
 * otherwise change what a later test counts — which is exactly how a passing
 * test makes an unrelated one fail. A store opens in about 300 ms, so
 * isolation is cheaper than any reset a test could get wrong.
 */
export async function startHarness(): Promise<{
  url: string;
  stop: () => Promise<void>;
}> {
  const port = await freePort();
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
