/**
 * The locations family's handlers. Each reads or writes the person's home
 * store and reads the roots it names, all through `KbRoots`, so none names a
 * file: what is at a path, which server serves it and how a store is opened
 * are the runtime's. What a write puts in the home store is planned by
 * `@kb/locations` and only committed here, in a session over the home store.
 */
import { Effect } from "effect";
import { KbCtx, KbRoots, KbStore, type KbContext, type KbRootsPort } from "@kb/contracts";
import { currentIso, domainError, freshId, type DomainError, type KbNode } from "@kb/model";
import { persistPlannedEffect } from "@kb/operations";
import {
  forgetWrites,
  locationEntries,
  registerWrites,
  type LocationEntry,
  type LocationList,
  type LocationOpened,
  type LocationRow,
  type LocationWrite,
} from "@kb/locations";

/** The one path a location holds, or why it holds none to read. */
function entryPath(entry: LocationEntry): { readonly path: string } | { readonly reason: string } {
  const [path] = entry.paths;
  if (path === undefined) return { reason: "the location holds no path" };
  if (entry.paths.length > 1)
    return { reason: `the location holds ${entry.paths.length} paths; keep one` };
  return { path };
}

/** What a location is now, read from its path. */
const rowOf = Effect.fn("ext.locations.row")(function* (
  roots: KbRootsPort,
  entry: LocationEntry,
  current: string,
): Effect.fn.Return<LocationRow, DomainError> {
  const { id, label, pinned } = entry;
  const held = entryPath(entry);
  if ("reason" in held) {
    const path = entry.paths[0] ?? "";
    return { id, label, pinned, path, current: false, status: "broken", reason: held.reason };
  }
  const probe = yield* roots.probe(held.path);
  const at = { id, label, pinned, path: probe.path, current: probe.path === current };
  const { state } = probe;
  if (state.kind !== "store") return { ...at, status: state.kind, reason: state.reason };
  const url = yield* roots.served(probe.path);
  return url === null
    ? { ...at, status: "closed", backend: state.backend }
    : { ...at, status: "served", url, backend: state.backend };
});

/** The root the call was made in, as a row's path names it. */
const currentRoot = Effect.fn("ext.locations.current")(function* (
  roots: KbRootsPort,
): Effect.fn.Return<string, DomainError, KbCtx> {
  const ctx = yield* KbCtx;
  return (yield* roots.probe(ctx.root)).path;
});

type Home =
  | { readonly path: string; readonly session: KbContext }
  | { readonly path: string; readonly session: null; readonly reason: string };

/** The home store, opened when there is one; else where it will be and why it is not there. */
const openHome = Effect.fn("ext.locations.openHome")(function* (
  roots: KbRootsPort,
): Effect.fn.Return<Home, DomainError> {
  const probe = yield* roots.probe(yield* roots.home);
  if (probe.state.kind !== "store")
    return {
      path: probe.path,
      session: null,
      reason: `no home store yet at ${probe.path} (${probe.state.reason}); registering a location creates it`,
    };
  const session = yield* roots
    .open(probe.path)
    .pipe(
      Effect.mapError((err) =>
        domainError("internal", `home store unreadable at ${probe.path}: ${err.message}`),
      ),
    );
  return { path: probe.path, session };
});

/** The home store's session and the location `id` in it; `not_found` when either is not there. */
const homeEntry = Effect.fn("ext.locations.homeEntry")(function* (
  roots: KbRootsPort,
  id: string,
): Effect.fn.Return<{ readonly home: KbContext; readonly entry: LocationEntry }, DomainError> {
  const home = yield* openHome(roots);
  if (home.session === null) return yield* domainError("not_found", home.reason);
  const entry = locationEntries(home.session.nodes).find((each) => each.id === id);
  if (entry === undefined)
    return yield* domainError("not_found", `no location ${id} in the home store`, { id });
  return { home: home.session, entry };
});

/**
 * Commit a write planned from the home store's nodes in its own session. A
 * write replaces the list node whole, so it lands only on the state it was
 * planned from, and is planned again when another process wrote home in
 * between (`persistPlannedEffect`).
 */
function commitHome(
  home: KbContext,
  plan: (nodes: readonly KbNode[]) => LocationWrite | null,
): Effect.Effect<LocationWrite | null, DomainError> {
  return persistPlannedEffect(home, (nodes) => Effect.succeed(plan(nodes)), {
    systemWrites: "system",
  }).pipe(Effect.provideService(KbStore, home.store));
}

/** One warning for each well-formed location that names a root an earlier one already names. */
function duplicateWarnings(rows: readonly LocationRow[]): string[] {
  const first = new Map<string, LocationRow>();
  return rows.flatMap((row) => {
    if (row.status === "broken") return [];
    const earlier = first.get(row.path);
    if (earlier === undefined) {
      first.set(row.path, row);
      return [];
    }
    return [`${row.label} (${row.id}) names the same root as ${earlier.label}: ${row.path}`];
  });
}

export const locationListEffect = Effect.fn("ext.locations.list")(function* (
  _input: Record<string, never>,
): Effect.fn.Return<LocationList, DomainError, KbRoots | KbCtx> {
  const roots = yield* KbRoots;
  const home = yield* openHome(roots);
  if (home.session === null) return { home: home.path, rows: [], warnings: [home.reason] };
  const current = yield* currentRoot(roots);
  const rows = yield* Effect.forEach(
    locationEntries(home.session.nodes),
    (entry) => rowOf(roots, entry, current),
    { concurrency: "unbounded" },
  );
  return { home: home.path, rows, warnings: duplicateWarnings(rows) };
});

export const locationRegisterEffect = Effect.fn("ext.locations.register")(function* (input: {
  readonly path: string;
  readonly label?: string;
}): Effect.fn.Return<LocationRow, DomainError, KbRoots | KbCtx> {
  const roots = yield* KbRoots;
  const target = yield* roots.probe(input.path);
  if (target.state.kind !== "store")
    return yield* domainError("not_found", `${target.path}: ${target.state.reason}`, {
      path: target.path,
      status: target.state.kind,
    });
  const homePath = yield* roots.home;
  yield* roots.create(homePath);
  const home = yield* openHome(roots);
  if (home.session === null) return yield* domainError("internal", home.reason);
  const request = {
    path: target.path,
    id: yield* freshId,
    ...(input.label === undefined ? {} : { label: input.label }),
  };
  const at = yield* currentIso;
  const write = yield* commitHome(home.session, (nodes) => registerWrites(nodes, request, at));
  const entry = locationEntries(home.session.nodes).find(({ id }) => id === write?.id);
  if (entry === undefined)
    return yield* domainError("internal", `${target.path} was registered but is not listed`);
  return yield* rowOf(roots, entry, yield* currentRoot(roots));
});

export const locationForgetEffect = Effect.fn("ext.locations.forget")(function* (input: {
  readonly id: string;
}): Effect.fn.Return<{ id: string; label: string; path: string }, DomainError, KbRoots> {
  const { home, entry } = yield* homeEntry(yield* KbRoots, input.id);
  const at = yield* currentIso;
  const write = yield* commitHome(home, (nodes) => forgetWrites(nodes, entry.id, at));
  if (write === null)
    return yield* domainError("not_found", `no location ${input.id} in the home store`, {
      id: input.id,
    });
  return { id: entry.id, label: entry.label, path: entry.paths[0] ?? "" };
});

/**
 * The root an open names: a location's path by its id, a path, or, given
 * neither, the home store, made when there is none yet, as registering
 * makes it.
 */
const openTarget = Effect.fn("ext.locations.openTarget")(function* (
  roots: KbRootsPort,
  input: { readonly id?: string; readonly path?: string },
): Effect.fn.Return<string, DomainError> {
  if (input.path !== undefined) return input.path;
  if (input.id === undefined) {
    const home = yield* roots.home;
    yield* roots.create(home);
    return home;
  }
  const { entry } = yield* homeEntry(roots, input.id);
  const held = entryPath(entry);
  if ("reason" in held)
    return yield* domainError("not_found", `${entry.label}: ${held.reason}`, { id: entry.id });
  return held.path;
});

/**
 * Open a root: answer the URL of the `kb ui` serving it. A served root only
 * moves first among the locations; a closed one gets a server started for
 * it, and that server ranks its root first itself, as every `kb ui` does,
 * so a start that fails ranks nothing.
 */
export const locationOpenEffect = Effect.fn("ext.locations.open")(function* (input: {
  readonly id?: string;
  readonly path?: string;
}): Effect.fn.Return<LocationOpened, DomainError, KbRoots | KbCtx> {
  const roots = yield* KbRoots;
  const probe = yield* roots.probe(yield* openTarget(roots, input));
  if (probe.state.kind !== "store")
    return yield* domainError("not_found", `${probe.path}: ${probe.state.reason}`, {
      path: probe.path,
      status: probe.state.kind,
    });
  const served = yield* roots.served(probe.path);
  if (served === null) return { url: yield* roots.serve(probe.path), path: probe.path };
  yield* locationRegisterEffect({ path: probe.path });
  return { url: served, path: probe.path };
});
