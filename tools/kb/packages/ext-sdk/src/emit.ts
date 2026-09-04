import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import type { PlatformError } from "effect/PlatformError";
import { join } from "node:path";
import { KB_SDK_DTS, KB_SDK_VERSION } from "./sdk-dts.text.ts";

function sdkDtsPath(root: string): string {
  return join(root, ".kb", "sdk.d.ts");
}

/** Return the embedded SDK declaration text (matches this kb binary). */
export function readEmbeddedSdkDts(): string {
  return KB_SDK_DTS;
}

/**
 * Write `<root>/.kb/sdk.d.ts` from the embedded SDK string.
 * Creates `.kb/` when missing. Returns bytes written and kb version stamp.
 */
export const writeSdkDts = Effect.fn("kb.writeSdkDts")(function* (
  root: string,
): Effect.fn.Return<{ path: string; bytes: number; version: string }, PlatformError, FileSystem> {
  const path = sdkDtsPath(root);
  const fs = yield* FileSystem;
  yield* fs.makeDirectory(join(root, ".kb"), { recursive: true });
  yield* fs.writeFileString(path, KB_SDK_DTS);
  return { path, bytes: KB_SDK_DTS.length, version: KB_SDK_VERSION };
});
