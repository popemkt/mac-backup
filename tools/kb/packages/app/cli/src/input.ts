/**
 * What a CLI argument names when it is not the value itself: a JSON blob or
 * stdin for `kb action-invoke`, a file or stdin for `kb add --outline`. A
 * malformed or unreadable argument is a usage error (exit 2); stdin that
 * fails to read is an I/O failure (exit 1).
 */
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { text as readStream } from "node:stream/consumers";
import { type DomainError, ensureDomainError } from "@kb/model";
import { UsageError } from "@kb/operations";

/**
 * Parse action-invoke JSON text with native JSON.parse diagnostics, then leave
 * structural/action Schema validation to mapActionInvoke + invokeReceiptEffect.
 */
function parseActionJson(text: string): Effect.Effect<unknown, UsageError> {
  return Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: (err) =>
      new UsageError({
        message: `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      }),
  });
}

/**
 * Read action-invoke JSON from an argv blob or stdin ("-").
 * Empty stdin → UsageError (exit 2). Genuine stdin I/O failures fold through
 * the one DomainError mapper and stay exit 1, matching pre-Effect CLI behavior.
 */
export function readActionJsonEffect(
  arg: string,
): Effect.Effect<unknown, UsageError | DomainError> {
  if (arg === "-") {
    return Effect.gen(function* () {
      const text = (yield* readStdinEffect).trim();
      if (!text) {
        return yield* new UsageError({ message: "action-invoke: empty stdin" });
      }
      return yield* parseActionJson(text);
    });
  }
  return parseActionJson(arg);
}

/** All of stdin; an I/O failure folds through the one DomainError mapper (exit 1). */
const readStdinEffect: Effect.Effect<string, DomainError> = Effect.tryPromise({
  try: () => readStream(process.stdin),
  catch: ensureDomainError,
});

/**
 * The text `--outline <file>` names: the file, or stdin for `-`. A file that
 * cannot be read is the caller's mistake (exit 2), like any bad argument.
 */
export function readOutlineEffect(
  arg: string,
): Effect.Effect<string, UsageError | DomainError, FileSystem> {
  if (arg === "-") return readStdinEffect;
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    return yield* fs
      .readFileString(arg)
      .pipe(
        Effect.mapError(
          (err) => new UsageError({ message: `--outline: cannot read ${arg}: ${err.message}` }),
        ),
      );
  });
}
