/**
 * Where the person's home store lives (DESIGN.md → Locations): `KB_HOME`
 * when it is set, else the platform's place for an application's own data,
 * outside every store. It is state produced by use, so it goes to regular
 * backup, never to git or Mackup (docs/backup-strategy.md → kb Home Store).
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";

/** The home store's directory, for an environment on a platform. */
export function homePath(
  env: Readonly<Record<string, string | undefined>>,
  platform: string,
  home: string,
): string {
  const set = env.KB_HOME;
  if (set !== undefined && set !== "") return resolve(set);
  if (platform === "darwin") return join(home, "Library", "Application Support", "kb", "home");
  const data = env.XDG_DATA_HOME;
  return join(
    data !== undefined && data !== "" ? data : join(home, ".local", "share"),
    "kb",
    "home",
  );
}

/**
 * The home store's directory now. The environment is read each time this
 * runs, not once per process, so a process that names another home (a test,
 * say) is answered with it.
 */
export const currentHome: Effect.Effect<string> = Effect.sync(() =>
  // oxlint-disable-next-line node/no-process-env -- kb's one read of where the person's home store lives
  homePath(process.env, process.platform, homedir()),
);
