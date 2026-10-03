import { hostname } from "node:os";
import { resolve } from "node:path";
import { Effect, Layer, Option, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { CodeTrust } from "@kb/contracts";
import { currentIso, type DomainError } from "@kb/model";
import { internal, isNotFound } from "./errors.ts";

/**
 * `.kb/trust.json`: the code a person has trusted, by content digest
 * (DESIGN.md → Sandbox → Trust). It is backup state, not intent: gitignored,
 * owned by the Mackup `kb` application like `.kb/assets`, so it comes back on
 * a restored machine and never reaches a commit (docs/backup-strategy.md).
 * Each record names the machine it was made on, and only this machine's
 * count: a copy restored onto another machine trusts nothing there.
 */
function trustFile(root: string): string {
  return resolve(root, ".kb", "trust.json");
}

const TrustRecord = Schema.Struct({
  digest: Schema.String,
  machine: Schema.String,
  at: Schema.String,
});
const TrustFile = Schema.Struct({ version: Schema.Literal(1), trusted: Schema.Array(TrustRecord) });
type TrustFile = typeof TrustFile.Type;

const decodeTrustFile = Schema.decodeUnknownOption(Schema.fromJsonString(TrustFile));

const EMPTY: TrustFile = { version: 1, trusted: [] };

/** `.kb/trust.json` under `root` on a FileSystem, for `machine` (this host by default). */
export function codeTrustLayer(
  root: string,
  machine: string = hostname(),
): Layer.Layer<CodeTrust, never, FileSystem> {
  return Layer.effect(
    CodeTrust,
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const file = trustFile(root);

      // A file that is missing, or not one this module wrote, trusts nothing.
      const read: Effect.Effect<TrustFile, DomainError> = fs.readFileString(file).pipe(
        Effect.map((text) => Option.getOrElse(decodeTrustFile(text), () => EMPTY)),
        Effect.catch((err) =>
          isNotFound(err)
            ? Effect.succeed(EMPTY)
            : Effect.fail(internal("read .kb/trust.json", err)),
        ),
      );

      const write = (next: TrustFile) =>
        Effect.gen(function* () {
          const tmp = `${file}.${String(process.pid)}.tmp`;
          yield* fs.writeFileString(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
          yield* fs.rename(tmp, file);
        }).pipe(Effect.mapError((err) => internal("write .kb/trust.json", err)));

      return CodeTrust.of({
        trusted: Effect.fn("kb.trust.trusted")(function* (digests: readonly string[]) {
          const mine = new Set(
            (yield* read).trusted
              .filter((record) => record.machine === machine)
              .map((record) => record.digest),
          );
          return digests.filter((digest) => mine.has(digest));
        }),
        trust: Effect.fn("kb.trust.trust")(function* (digest: string) {
          const current = yield* read;
          if (current.trusted.some((r) => r.digest === digest && r.machine === machine)) return;
          const at = yield* currentIso;
          yield* write({ version: 1, trusted: [...current.trusted, { digest, machine, at }] });
        }),
        untrust: Effect.fn("kb.trust.untrust")(function* (digest: string) {
          const current = yield* read;
          const kept = current.trusted.filter(
            (r) => !(r.digest === digest && r.machine === machine),
          );
          if (kept.length === current.trusted.length) return;
          yield* write({ version: 1, trusted: kept });
        }),
      });
    }),
  );
}
