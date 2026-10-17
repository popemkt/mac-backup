/**
 * A repository extension as a test writes one: the file under
 * `.kb/extensions/`, trusted on this machine the way a person's
 * `sandbox.trust` records it, since an untrusted file is never imported
 * (DESIGN.md → Core boundary & extensions → repository extensions).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { CodeTrust } from "@kb/contracts";
import { bunFileSystemLayer } from "@kb/runtime";
import { extensionDigest } from "@kb/sandbox";
import { codeTrustLayer } from "@kb/workspace-fs";

/** Write `.kb/extensions/<file>` under `root` with `source`, without trusting it. */
export const writeExtensionEffect = Effect.fn("test.writeExtension")(function* (
  root: string,
  file: string,
  source: string,
) {
  const dir = join(root, ".kb", "extensions");
  yield* Effect.promise(() => mkdir(dir, { recursive: true }));
  const path = join(dir, file);
  yield* Effect.promise(() => writeFile(path, source, "utf8"));
  return path;
});

/** Trust `source` as a repository extension of `root` on this machine. */
export const trustExtensionEffect = Effect.fn("test.trustExtension")(function* (
  root: string,
  source: string,
) {
  const digest = yield* extensionDigest(source);
  yield* Effect.gen(function* () {
    yield* (yield* CodeTrust).trust(digest);
  }).pipe(Effect.provide(codeTrustLayer(root).pipe(Layer.provide(bunFileSystemLayer))));
});

/** Write `.kb/extensions/<file>` under `root` and trust it, as its owner would. */
export const writeTrustedExtensionEffect = Effect.fn("test.writeTrustedExtension")(function* (
  root: string,
  file: string,
  source: string,
) {
  const path = yield* writeExtensionEffect(root, file, source);
  yield* trustExtensionEffect(root, source);
  return path;
});

export const writeExtension = (root: string, file: string, source: string): Promise<string> =>
  Effect.runPromise(writeExtensionEffect(root, file, source));
export const trustExtension = (root: string, source: string): Promise<void> =>
  Effect.runPromise(trustExtensionEffect(root, source));
export const writeTrustedExtension = (
  root: string,
  file: string,
  source: string,
): Promise<string> => Effect.runPromise(writeTrustedExtensionEffect(root, file, source));
