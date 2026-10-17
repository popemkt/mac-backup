/**
 * Starting a `kb ui` for a root (`serveRoot`, DESIGN.md → Locations): a real
 * `kb ui --port 0` over a temp root, whose URL in presence answers for that
 * root, the two ways a start fails, each reported with what the child
 * wrote to stderr, and a child that never served stopped with its start;
 * concurrent starts for one root are one start (`oneStartPerRoot`).
 *
 * The child runs with `KB_PKG_ROOT` pointing at an empty directory: there is
 * no UI package there to build, so the server starts at once and serves its
 * API, which is all a start waits for.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Deferred, Effect, Fiber } from "effect";
import { readUiPresence, servingUi } from "@kb/workspace-fs";
import { domainError } from "@kb/model";
import { childProcessEnv } from "../src/child-env.ts";
import { bunFileSystemLayer } from "../src/platform.ts";
import { oneStartPerRoot, serveRoot, type UiLaunch } from "../src/serve.ts";
import { createStore } from "../src/store-selection.ts";

const CLI = join(import.meta.dir, "..", "..", "cli", "src", "main.ts");

let scratch = "";
let root = "";

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

function launch(command: UiLaunch["command"], timeoutMs: number): UiLaunch {
  return {
    command,
    env: childProcessEnv("kb", {
      KB_PKG_ROOT: join(scratch, "pkg"),
      KB_HOME: join(scratch, "home"),
    }),
    timeoutMs,
  };
}

/** Whether `pid` names a running process. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Whether `pid` has exited within `ms`. */
async function exitsWithin(pid: number, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (alive(pid)) {
    if (Date.now() > until) return false;
    await Bun.sleep(20);
  }
  return true;
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

  test("a child that does not answer in time fails, and is stopped", async () => {
    const pidFile = join(scratch, "child.pid");
    const script = [
      `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))`,
      "console.error('warming up')",
      "setTimeout(() => {}, 20_000)",
    ].join("; ");
    const message = await failureOf(
      serveRoot(root, launch([process.execPath, "-e", script], 500)).pipe(
        Effect.provide(bunFileSystemLayer),
      ),
    );
    expect(message).toContain("did not answer within 0.5s, so it was stopped");
    expect(message).toContain("warming up");
    expect(await exitsWithin(Number(await readFile(pidFile, "utf8")), 2000)).toBe(true);
  });
});

describe("stopping a child that never served", () => {
  beforeEach(async () => {
    scratch = await realpath(await mkdtemp(join(tmpdir(), "kb-serve-")));
    root = join(scratch, "root");
    await mkdir(join(scratch, "pkg"));
    await mkdir(root);
  });
  afterEach(() => rm(scratch, { recursive: true, force: true }));

  test("a child that ignores SIGTERM is killed once its grace has passed", async () => {
    const pidFile = join(scratch, "child.pid");
    const script = [
      `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))`,
      "process.on('SIGTERM', () => {})",
      "setInterval(() => {}, 1000)",
    ].join("; ");
    const message = await failureOf(
      serveRoot(root, launch([process.execPath, "-e", script], 500)).pipe(
        Effect.provide(bunFileSystemLayer),
      ),
    );
    expect(message).toContain("so it was stopped");
    expect(await exitsWithin(Number(await readFile(pidFile, "utf8")), 1000)).toBe(true);
  }, 10_000);

  test("what a child started is killed with it, though the child itself exits on SIGTERM", async () => {
    const pidFile = join(scratch, "grandchild.pid");
    const grandchild = [
      `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))`,
      "process.on('SIGTERM', () => {})",
      "setInterval(() => {}, 1000)",
    ].join("; ");
    const script = [
      `require("node:child_process").spawn(${JSON.stringify(process.execPath)}, ["-e", ${JSON.stringify(grandchild)}], { stdio: "ignore" })`,
      "setInterval(() => {}, 1000)",
    ].join("; ");
    const message = await failureOf(
      serveRoot(root, launch([process.execPath, "-e", script], 500)).pipe(
        Effect.provide(bunFileSystemLayer),
      ),
    );
    expect(message).toContain("so it was stopped");
    expect(await exitsWithin(Number(await readFile(pidFile, "utf8")), 1000)).toBe(true);
  }, 10_000);
});

describe("one start per root", () => {
  test("a start for a root that is already starting waits for it and gets its answer", async () => {
    const started: string[] = [];
    const release = Deferred.makeUnsafe<void>();
    const serve = oneStartPerRoot((at) =>
      Effect.sync(() => started.push(at)).pipe(
        Effect.andThen(Deferred.await(release)),
        Effect.as(`http://127.0.0.1:${started.length}`),
      ),
    );
    const answers = await run(
      Effect.gen(function* () {
        const fibers = yield* Effect.forEach(["/a", "/a", "/b"], (at) =>
          Effect.forkChild(serve(at)),
        );
        yield* Effect.yieldNow;
        yield* Deferred.succeed(release, undefined);
        return yield* Fiber.joinAll(fibers);
      }),
    );
    expect(started).toEqual(["/a", "/b"]);
    expect(answers[0]).toBe(answers[1]);
    expect(answers[2]).not.toBe(answers[0]);
  });

  test("a root whose start has ended starts again, and a failure reaches every waiter", async () => {
    let starts = 0;
    const serve = oneStartPerRoot(() =>
      Effect.sync(() => ++starts).pipe(
        Effect.andThen(Effect.sleep(10)),
        Effect.andThen(Effect.fail(domainError("internal", "no"))),
      ),
    );
    const failures = await run(
      Effect.forEach([serve("/a"), serve("/a")], Effect.flip, { concurrency: "unbounded" }),
    );
    expect(failures.map(({ message }) => message)).toEqual(["no", "no"]);
    await run(Effect.flip(serve("/a")));
    expect(starts).toBe(2);
  });
});
