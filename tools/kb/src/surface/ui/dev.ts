/**
 * `kb ui --dev` child-process primitives.
 *
 * The Vite dev server is spawned as a child of the `kb ui` process and proxies
 * /api, /assets and /ws back to the kb backend (single source of truth). The
 * spawn is injectable so tests can exercise process/error/port handling
 * without a browser, a live checkout, or a real Vite process.
 */

export const UI_DEV_DEFAULT_PORT = 5173;

/** Minimal child-process surface needed by the dev orchestration. */
export interface UiDevChild {
  pid?: number;
  kill(): void;
  /** Resolves with the exit code when the child terminates. */
  exited: Promise<number | null>;
}

export interface UiDevSpawnOpts {
  cmd: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

export type UiDevSpawn = (opts: UiDevSpawnOpts) => UiDevChild;

/** Real spawn: `bun run dev --port <n>` with the backend port in the env. */
export function bunSpawnDev(opts: UiDevSpawnOpts): UiDevChild {
  const proc = Bun.spawn([opts.cmd, ...opts.args], {
    cwd: opts.cwd,
    env: opts.env,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  return {
    pid: proc.pid,
    kill: () => {
      try {
        proc.kill();
      } catch {
        // already gone
      }
    },
    exited: proc.exited,
  };
}

/**
 * Await the dev child exit, then tear down the backend listener. Returns the
 * child exit code (null when the child died by signal). Testable with a fake
 * child: the backend stop is the observable side effect.
 */
export async function runDevUntilExit(
  dev: {
    child: UiDevChild;
    backend: { stop(): Promise<void> };
  },
  onExit?: (code: number | null) => void,
): Promise<number | null> {
  const code = await dev.child.exited;
  await dev.backend.stop();
  onExit?.(code);
  return code;
}
