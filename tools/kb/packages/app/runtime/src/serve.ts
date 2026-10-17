/**
 * Starting a `kb ui` over a root (DESIGN.md → Locations): a detached child
 * that runs kb's own command as `kb --root <root> ui --port 0 --no-open`.
 * Port 0 is any free port, so the new server never contends with one
 * already listening. It writes its presence once it listens, and the start
 * is done when that presence names a server answering for the root
 * (`servingUi`).
 *
 * The child outlives the call and this process. Nothing supervises it, just
 * as nothing supervises a `kb ui` a person starts. Its stderr goes to a log
 * file, and a failed start reports the file's tail.
 */
import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { join } from "node:path";
import { Effect, Option } from "effect";
import { FileSystem } from "effect/FileSystem";
import { domainError, ensureDomainError, type DomainError } from "@kb/model";
import { servingUi } from "@kb/workspace-fs";
import { childProcessEnv } from "./child-env.ts";

/** How a `kb ui` is started: the kb command, the environment it runs in, and how long it gets. */
export interface UiLaunch {
  /** The executable and the arguments that come before kb's own: `kb`, as this machine runs it. */
  readonly command: readonly [string, ...string[]];
  readonly env: Readonly<Record<string, string>>;
  /** How long the server gets to say it serves the root. */
  readonly timeoutMs: number;
}

/** About ten seconds: enough for a server whose UI is built, and it is told when it is not. */
const START_TIMEOUT_MS = 10_000;
const POLL_MS = 100;
/** How much of the log a failed start reports. */
const TAIL_CHARS = 2000;

/**
 * The kb this process runs as: the runtime it runs on and the entry it was
 * started with, which is kb's CLI for every surface that invokes an action
 * (`kb ui`, `kb mcp`, the CLI itself, the packaged wrapper's `cli.js`).
 */
export function selfLaunch(): UiLaunch {
  const [, entry] = process.argv;
  return {
    command: entry === undefined ? [process.execPath] : [process.execPath, entry],
    env: childProcessEnv("kb"),
    timeoutMs: START_TIMEOUT_MS,
  };
}

/** Start the child, detached, its stderr appended to `log`; `ended` hears when it exits or cannot start. */
function startChild(
  launch: UiLaunch,
  root: string,
  log: string,
  ended: (how: string) => void,
): void {
  const [cmd, ...pre] = launch.command;
  const fd = openSync(log, "a", 0o600);
  try {
    const child = spawn(cmd, [...pre, "--root", root, "ui", "--port", "0", "--no-open"], {
      detached: true,
      stdio: ["ignore", "ignore", fd],
      env: { ...launch.env },
    });
    child.once("exit", (code, signal) => ended(signal ?? `exit code ${String(code)}`));
    child.once("error", (err) => ended(err.message));
    child.unref();
  } finally {
    closeSync(fd);
  }
}

/** The end of the log, or a note that there is nothing in it. */
const logTail = Effect.fn("kb.serve.tail")(function* (
  log: string,
): Effect.fn.Return<string, never, FileSystem> {
  const fs = yield* FileSystem;
  const text = yield* fs.readFileString(log).pipe(Effect.orElseSucceed(() => ""));
  const tail = text.trim().slice(-TAIL_CHARS);
  return tail === "" ? `nothing on stderr (${log})` : `${tail}\n(${log})`;
});

/**
 * Start a `kb ui` serving `root` and answer its URL once it says it serves
 * the root. Fails `internal` with the tail of its stderr when it exits
 * first, or when it has not answered in time; a server that is only slow
 * (building its UI, say) keeps starting, and a later open finds it.
 */
export const serveRoot = Effect.fn("kb.serve")(function* (
  root: string,
  launch: UiLaunch,
): Effect.fn.Return<string, DomainError, FileSystem> {
  const fs = yield* FileSystem;
  const dir = yield* fs
    .makeTempDirectory({ prefix: "kb-ui-" })
    .pipe(Effect.mapError(ensureDomainError));
  const log = join(dir, "stderr.log");
  let ended: string | null = null;
  yield* Effect.try({
    try: () =>
      startChild(launch, root, log, (how) => {
        ended = how;
      }),
    catch: (err) => domainError("internal", `kb ui could not start for ${root}: ${String(err)}`),
  });
  const answered = yield* Effect.gen(function* () {
    for (;;) {
      const url = yield* servingUi(root);
      if (url !== null) return { kind: "served", url } as const;
      if (ended !== null) return { kind: "stopped", how: ended } as const;
      yield* Effect.sleep(POLL_MS);
    }
  }).pipe(Effect.timeoutOption(launch.timeoutMs));
  const outcome = Option.getOrNull(answered);
  if (outcome?.kind === "served") return outcome.url;
  const tail = yield* logTail(log);
  const why =
    outcome === null
      ? `kb ui for ${root} did not answer within ${launch.timeoutMs / 1000}s; it may still be starting`
      : `kb ui for ${root} stopped (${outcome.how}) before it served`;
  return yield* domainError("internal", `${why}: ${tail}`, { root });
});
