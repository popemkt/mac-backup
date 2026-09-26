/**
 * Seed fast-check for every property in the run, when asked to.
 *
 * Loaded before each `bun test` file (`bunfig.toml` → `[test] preload`), and
 * inert unless `KB_FAST_CHECK_SEED` names a seed. The ordinary suites leave it
 * unset, so each run draws fresh data and keeps exploring. The mutation run
 * sets it (`stryker.config.json`), because a mutant has to meet the same data
 * as the source it is compared with: unseeded, three runs over byte-identical
 * source killed different mutants and the survivor list was noise.
 */
import fc from "fast-check";
import { Config, Effect, Option } from "effect";

const seed = Effect.runSync(Config.option(Config.int("KB_FAST_CHECK_SEED")));
if (Option.isSome(seed)) {
  fc.configureGlobal({ ...fc.readConfigureGlobal(), seed: seed.value });
}
