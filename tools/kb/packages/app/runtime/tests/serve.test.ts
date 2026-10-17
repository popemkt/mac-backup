/**
 * Starting a `kb ui` for a root (`serveRoot`, DESIGN.md → Locations): a real
 * `kb ui --port 0` over a temp root, whose URL in presence answers for that
 * root, and the two ways a start fails, each reported with what the child
 * wrote to stderr.
 *
 * The child runs with `KB_PKG_ROOT` pointing at an empty directory: there is
 * no UI package there to build, so the server starts at once and serves its
 * API, which is all a start waits for.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { readUiPresence, servingUi } from "@kb/workspace-fs";
import { childProcessEnv } from "../src/child-env.ts";
import { bunFileSystemLayer } from "../src/platform.ts";
import { serveRoot, type UiLaunch } from "../src/serve.ts";
import { createStore } from "../src/store-selection.ts";

const CLI = join(import.meta.dir, "..", "..", "cli", "src", "main.ts");

let scratch = "";
let root = "";

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

function launch(command: UiLaunch["command"], timeoutMs: number): UiLaunch {
  return {
    command,
    env: childProcessEnv({ KB_PKG_ROOT: join(scratch, "pkg"), KB_HOME: join(scratch, "home") }),
    timeoutMs,
  };
}

/** The message of the failure `effect` ends in. */
function failureOf(effect: Effect.Effect<string, { message: string }>): Promise<string> {
  return run(
    effect.pipe(
      Effect.map((url) => `served at ${url}`),
      Effect.catch((err) => Effect.succeed(err.message)),
    ),
  );
}

describe("starting a kb ui for a root", () => {
  beforeEach(async () => {
    scratch = await realpath(await mkdtemp(join(tmpdir(), "kb-serve-")));
    root = join(scratch, "root");
    await mkdir(join(scratch, "pkg"));
    await mkdir(root);
    await run(createStore(root, "jsonl").pipe(Effect.provide(bunFileSystemLayer)));
  });

  afterEach(async () => {
    const presence = await run(readUiPresence(root).pipe(Effect.provide(bunFileSystemLayer)));
    if (presence !== null) process.kill(presence.pid, "SIGTERM");
    await rm(scratch, { recursive: true, force: true });
  });

  test("kb ui --port 0 starts detached, and the URL in its presence answers for the root", async () => {
    const url = await run(
      serveRoot(root, launch([process.execPath, CLI], 20_000)).pipe(
        Effect.provide(bunFileSystemLayer),
      ),
    );
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(url).not.toBe("http://127.0.0.1:4321");
    expect(await run(servingUi(root).pipe(Effect.provide(bunFileSystemLayer)))).toBe(url);
    const identity = (await (await fetch(`${url}/api/identity`)).json()) as { root: string };
    expect(identity.root).toBe(root);
  }, 30_000);

  test("a child that stops before it serves fails with its exit and its stderr", async () => {
    const message = await failureOf(
      serveRoot(
        root,
        launch(
          [process.execPath, "-e", "console.error('no store for you'); process.exit(3)"],
          10_000,
        ),
      ).pipe(Effect.provide(bunFileSystemLayer)),
    );
    expect(message).toContain("stopped (exit code 3)");
    expect(message).toContain("no store for you");
  });

  test("a child that does not answer in time fails, and says it may still be starting", async () => {
    const message = await failureOf(
      serveRoot(
        root,
        launch(
          [process.execPath, "-e", "console.error('warming up'); setTimeout(() => {}, 2000)"],
          500,
        ),
      ).pipe(Effect.provide(bunFileSystemLayer)),
    );
    expect(message).toContain("did not answer within 0.5s; it may still be starting");
    expect(message).toContain("warming up");
  });
});
