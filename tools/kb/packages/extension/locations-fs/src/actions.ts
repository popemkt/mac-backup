/**
 * The locations family's handlers. Each reads or writes the person's home
 * store and reads the roots it names, all through `KbRoots`, so none names a
 * file: what is at a path, which server serves it and how a store is opened
 * are the runtime's. What a write puts in the home store is planned by
 * `@kb/locations` and only committed here, in a session over the home store.
 */
import { Effect } from "effect";
import { KbCtx, KbRoots, KbStore, type KbContext, type KbRootsPort } from "@kb/contracts";
import { currentIso, domainError, freshId, type DomainError, type StoreTx } from "@kb/model";
import { persistEffect } from "@kb/operations";
import {
  forgetWrites,
  locationEntries,
  registerWrites,
  type LocationEntry,
  type LocationList,
  type LocationRow,
  type LocationWrite,
} from "@kb/locations";
import { currentHome } from "./home.ts";

/** What a location is now, read from its path. */
const rowOf = Effect.fn("ext.locations.row")(function* (
  roots: KbRootsPort,
  entry: LocationEntry,
  current: string,
): Effect.fn.Return<LocationRow, DomainError> {
  const { id, label, pinned } = entry;
  const [path] = entry.paths;
  if (path === undefined || entry.paths.length > 1) {
    const reason =
      path === undefined
        ? "the location holds no path"
        : `the location holds ${entry.paths.length} paths; keep one`;
    return { id, label, pinned, path: path ?? "", current: false, status: "broken", reason };
  }
  const probe = yield* roots.probe(path);
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
  const probe = yield* roots.probe(yield* currentHome);
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

/** Commit a planned write in the home store's own session. */
function commitHome(home: KbContext, write: LocationWrite): Effect.Effect<void, DomainError> {
  if (write.upserts.length === 0 && write.deletes.length === 0) return Effect.void;
  const tx: StoreTx = { upserts: [...write.upserts], deletes: [...write.deletes] };
  return persistEffect(home, tx).pipe(Effect.provideService(KbStore, home.store));
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
  const homePath = yield* currentHome;
  yield* roots.create(homePath);
  const home = yield* openHome(roots);
  if (home.session === null) return yield* domainError("internal", home.reason);
  const write = registerWrites(
    home.session.nodes,
    {
      path: target.path,
      id: yield* freshId,
      ...(input.label === undefined ? {} : { label: input.label }),
    },
    yield* currentIso,
  );
  yield* commitHome(home.session, write);
  const entry = locationEntries(home.session.nodes).find(({ id }) => id === write.id);
  if (entry === undefined)
    return yield* domainError("internal", `${target.path} was registered but is not listed`);
  return yield* rowOf(roots, entry, yield* currentRoot(roots));
});

export const locationForgetEffect = Effect.fn("ext.locations.forget")(function* (input: {
  readonly id: string;
}): Effect.fn.Return<{ id: string; label: string; path: string }, DomainError, KbRoots> {
  const roots = yield* KbRoots;
  const home = yield* openHome(roots);
  if (home.session === null) return yield* domainError("not_found", home.reason);
  const entry = locationEntries(home.session.nodes).find(({ id }) => id === input.id);
  const write = forgetWrites(home.session.nodes, input.id, yield* currentIso);
  if (entry === undefined || write === null)
    return yield* domainError("not_found", `no location ${input.id} in the home store`, {
      id: input.id,
    });
  yield* commitHome(home.session, write);
  return { id: entry.id, label: entry.label, path: entry.paths[0] ?? "" };
});
