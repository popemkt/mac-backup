/**
 * Where the person's home store lives (DESIGN.md → Locations): `KB_HOME`
 * when it is set, else the platform's place for an application's own data,
 * outside every store. It is state produced by use, so it goes to regular
 * backup, never to git or Mackup (docs/backup-strategy.md → kb Home Store).
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Config, Effect, Option } from "effect";
import { domainError } from "@kb/model";

export const resolveHomeEffect = Effect.fn("ext.locations.home")(
  function* () {
    const set = yield* Config.option(Config.nonEmptyString("KB_HOME"));
    if (Option.isSome(set)) return resolve(set.value);
    if (process.platform === "darwin")
      return join(homedir(), "Library", "Application Support", "kb", "home");
    const data = yield* Config.option(Config.nonEmptyString("XDG_DATA_HOME"));
    return join(
      Option.getOrElse(data, () => join(homedir(), ".local", "share")),
      "kb",
      "home",
    );
  },
  Effect.mapError((err) =>
    domainError("internal", `where the home store lives cannot be read: ${err.message}`),
  ),
);
