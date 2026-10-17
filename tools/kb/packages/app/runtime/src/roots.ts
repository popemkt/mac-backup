/**
 * The {@link KbRoots} port on this machine's filesystem: a path is probed by
 * what the directory holds (the store chosen by presence, as opening chooses
 * it), a root is served when `.kb/ui.json` names a server that answers for
 * it (`servingUi`), a session over another root is opened exactly as this
 * process opened its own, and the `kb ui` started for a root runs this
 * process's own kb (`serveRoot`, `selfLaunch`), one start per root at a
 * time (`oneStartPerRoot`).
 */
import { resolve } from "node:path";
import { Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import { KbRoots, type RootProbe } from "@kb/contracts";
import { ensureDomainError, type DomainError } from "@kb/model";
import { canonicalRoot, servingUi } from "@kb/workspace-fs";
import { openKbEffect } from "./open.ts";
import { oneStartPerRoot, selfLaunch, serveRoot } from "./serve.ts";
import { createStore, storeBackendAt } from "./store-selection.ts";

/** The store a new root is made with: the default `kb init` makes. */
const NEW_ROOT_BACKEND = "jsonl";

const probeRoot = Effect.fn("kb.roots.probe")(function* (
  path: string,
): Effect.fn.Return<RootProbe, DomainError, FileSystem> {
  const fs = yield* FileSystem;
  const absolute = resolve(path);
  const there = yield* fs.exists(absolute).pipe(Effect.mapError(ensureDomainError));
  if (!there)
    return { path: absolute, state: { kind: "missing", reason: `nothing at ${absolute}` } };
  const root = yield* canonicalRoot(absolute);
  const info = yield* fs.stat(root).pipe(Effect.mapError(ensureDomainError));
  if (info.type !== "Directory")
    return { path: root, state: { kind: "not-a-store", reason: `${root} is not a directory` } };
  const backend = yield* storeBackendAt(root).pipe(
    Effect.map((found) => ({ found })),
    Effect.catch((err) => Effect.succeed({ conflict: err.message })),
  );
  if ("conflict" in backend)
    return { path: root, state: { kind: "not-a-store", reason: backend.conflict } };
  return backend.found === null
    ? { path: root, state: { kind: "not-a-store", reason: `no kb store under ${root}/.kb` } }
    : { path: root, state: { kind: "store", backend: backend.found } };
});

/** Make `root` a kb root, its directory first; a root that already is one is left alone. */
const createRoot = Effect.fn("kb.roots.create")(function* (
  root: string,
): Effect.fn.Return<void, DomainError, FileSystem> {
  const fs = yield* FileSystem;
  yield* fs.makeDirectory(root, { recursive: true }).pipe(Effect.mapError(ensureDomainError));
  if ((yield* storeBackendAt(root)) !== null) return;
  yield* createStore(root, NEW_ROOT_BACKEND);
});

export const kbRootsLayer: Layer.Layer<KbRoots, never, FileSystem> = Layer.effect(
  KbRoots,
  Effect.gen(function* () {
    const context = yield* Effect.context<FileSystem>();
    const launch = selfLaunch();
    const serve = oneStartPerRoot((root) => serveRoot(root, launch).pipe(Effect.provide(context)));
    return KbRoots.of({
      probe: (path) => probeRoot(path).pipe(Effect.provide(context)),
      served: (root) => servingUi(root).pipe(Effect.provide(context)),
      create: (root) => createRoot(root).pipe(Effect.provide(context)),
      // GAP [[01M39XVZCR684Y1V9FXNDT44D5]]: the store opened here is never
      // released, as no selected store is; a sqlite root keeps its connection.
      open: (root) => openKbEffect(root).pipe(Effect.provide(context)),
      serve,
    });
  }),
);
