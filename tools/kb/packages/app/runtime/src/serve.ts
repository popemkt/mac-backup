/**
 * Starting a `kb ui` over a root (DESIGN.md → Locations): a detached child
 * that runs kb's own command as `kb --root <root> ui --port 0 --no-open`.
 * Port 0 is any free port, so the new server never contends with one
 * already listening. It writes its presence once it listens, and the start
 * is done when that presence names a server answering for the root
 * (`servingUi`).
 *
 * A child that serves outlives the call and this process. Nothing
 * supervises it, just as nothing supervises a `kb ui` a person starts. Until
 * it serves it belongs to the start: a start that fails, by timing out or by
 * being interrupted, stops it, so a failed start leaves no server behind.
 * Its stderr goes to a log file, and a failed start reports the file's tail.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { join } from "node:path";
import { Deferred, Effect, Exit, Option, type Scope } from "effect";
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
/** How long a child that never served gets to stop on SIGTERM before it is killed. */
const STOP_GRACE_MS = 2000;
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
): ChildProcess {
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
    return child;
  } finally {
    closeSync(fd);
  }
}

/**
 * Send `signal` to the child's process group (it was started detached, so it
 * leads one), and answer whether the group had anyone to receive it; signal
 * 0 only asks.
 */
function signalGroup(child: ChildProcess, signal: NodeJS.Signals | 0): boolean {
  if (child.pid === undefined) return false;
  try {
    process.kill(-child.pid, signal);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stop a child that never served, and whatever it started (a UI build):
 * SIGTERM, a grace period for it to exit, then SIGKILL for what is left of
 * its group, so a child that ignores SIGTERM does not outlive its start. A
 * group with nobody left in it is not signalled again: its id is free, and
 * by then may be another's.
 */
const stopChild = Effect.fn("kb.serve.stop")(function* (
  child: ChildProcess,
  exited: () => boolean,
): Effect.fn.Return<void> {
  signalGroup(child, "SIGTERM");
  yield* Effect.gen(function* () {
    while (!exited()) yield* Effect.sleep(POLL_MS);
  }).pipe(Effect.timeoutOption(STOP_GRACE_MS));
  if (signalGroup(child, 0)) signalGroup(child, "SIGKILL");
});

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
 * first, or when it has not answered in time, and then it is stopped: a
 * start is one attempt, and a server that comes up after its start gave up
 * is one nobody asked for.
 */
export const serveRoot = Effect.fn("kb.serve")(function* (
  root: string,
  launch: UiLaunch,
): Effect.fn.Return<string, DomainError, FileSystem | Scope.Scope> {
  const fs = yield* FileSystem;
  const dir = yield* fs
    .makeTempDirectory({ prefix: "kb-ui-" })
    .pipe(Effect.mapError(ensureDomainError));
  const log = join(dir, "stderr.log");
  let ended: string | null = null;
  yield* Effect.acquireRelease(
    Effect.try({
      try: () =>
        startChild(launch, root, log, (how) => {
          ended = how;
        }),
      catch: (err) => domainError("internal", `kb ui could not start for ${root}: ${String(err)}`),
    }),
    (child, exit) =>
      Exit.isSuccess(exit) || ended !== null ? Effect.void : stopChild(child, () => ended !== null),
  );
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
      ? `kb ui for ${root} did not answer within ${launch.timeoutMs / 1000}s, so it was stopped`
      : `kb ui for ${root} stopped (${outcome.how}) before it served`;
  return yield* domainError("internal", `${why}: ${tail}`, { root });
}, Effect.scoped);

type Start = (root: string) => Effect.Effect<string, DomainError>;

/**
 * `start` with one start per root at a time in this process: a call for a
 * root that is already starting waits for that start and gets its answer,
 * its URL or its failure, instead of starting a second server.
 */
// GAP [[01M545PFJ3285JNXYHKVCM50Z7]]: one start per root in this process only; two
// processes starting one root at once can each start a server.
export function oneStartPerRoot(start: Start): Start {
  const starting = new Map<string, Deferred.Deferred<string, DomainError>>();
  return (root) =>
    Effect.suspend(() => {
      const joined = starting.get(root);
      if (joined !== undefined) return Deferred.await(joined);
      const answer = Deferred.makeUnsafe<string, DomainError>();
      starting.set(root, answer);
      return start(root).pipe(
        Effect.onExit((exit) =>
          Effect.sync(() => starting.delete(root)).pipe(
            Effect.andThen(Deferred.done(answer, exit)),
          ),
        ),
      );
    });
}
