/**
 * The locations contract: the locations family's promises over a home store
 * of every backend (DESIGN.md → Locations). The home store is a kb root like
 * any other, so what the actions promise holds whichever store it is. Each property runs
 * the actions the way every surface does, through the invoke core in a
 * session over a root of their own, with the home store `KB_HOME` names.
 *
 * - registering is idempotent by canonical path, so a symlinked spelling of
 *   a root finds its node;
 * - registering ranks a location first;
 * - forgetting deletes the node and leaves its directory byte for byte;
 * - status is read from each path: a JSONL store, a SQLite store, nothing
 *   there, a plain directory, and a store a live server answers for;
 * - a malformed location lists as broken, and two for one root warn;
 * - listing writes to no listed store;
 * - the tag and the field are minted once;
 * - the root a person opens is registered on their surface's wire, so an
 *   agent's asks;
 * - opening a served root answers its URL and ranks it first; opening a
 *   closed one starts a server for it, and a start that fails ranks
 *   nothing; opening what is missing or not a store starts nothing; opening
 *   nothing opens the home store, and makes it when there is none.
 *
 * `serve` is a stand-in that answers for the root as a started server
 * would, except in one case, which opens a closed root through the real
 * `serveRoot`: a real `kb ui --port 0` (with no UI package to build, so it
 * serves its API at once) that answers for the root and ranks it first
 * itself. How a start fails has a test of its own, serve.test.ts.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { KbRoots, onWire, type ActionReceipt, type KbContext } from "@kb/contracts";
import {
  LOCATION_IDS,
  LocationListSchema,
  LocationOpenedSchema,
  LocationRowSchema,
} from "@kb/locations";
import { SYSTEM_IDS, domainError, type Actor, type DomainError, type KbNode } from "@kb/model";
import { readUiPresence, writeUiPresence } from "@kb/workspace-fs";
import { CONTRACT_AT, pointHomeAt } from "@kb/test-kit";
import { kbRuntimeLayer } from "../src/layers.ts";
import { openKbEffect } from "../src/open.ts";
import { bunFileSystemLayer } from "../src/platform.ts";
import { childProcessEnv } from "../src/child-env.ts";
import { registerOpenedRoot } from "../src/locations.ts";
import { IN_PROCESS_WIRE } from "../src/invoke.ts";
import { invokeReceiptEffect } from "../src/registry.ts";
import { serveRoot } from "../src/serve.ts";
import { STORE_BACKENDS, createStore, type StoreBackend } from "../src/store-selection.ts";

const CLI = join(import.meta.dir, "..", "..", "cli", "src", "main.ts");

/** Every file under `dir` with its bytes, so a directory can be compared before and after. */
const snapshot = Effect.fn("locationsContract.snapshot")(function* (dir: string) {
  const entries = yield* Effect.promise(() =>
    readdir(dir, { recursive: true, withFileTypes: true }),
  );
  const files = yield* Effect.forEach(
    entries.filter((entry) => entry.isFile()),
    (entry) => {
      const path = join(entry.parentPath, entry.name);
      return Effect.promise(() => readFile(path, "base64")).pipe(
        Effect.map((bytes) => [path, bytes] as const),
      );
    },
  );
  return Object.fromEntries(files);
});

const openRoot = (root: string): Effect.Effect<KbContext, DomainError> =>
  openKbEffect(root).pipe(Effect.provide(bunFileSystemLayer));

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

/** A node tagged `#kb-location` by hand, holding `paths`. */
function taggedByHand(id: string, paths: readonly string[]): KbNode {
  return {
    id,
    text: id,
    props: {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: LOCATION_IDS.tag }],
      [LOCATION_IDS.pathField]: paths.map((v) => ({ t: "str" as const, v })),
    },
    children: [],
    createdAt: CONTRACT_AT,
    updatedAt: CONTRACT_AT,
  };
}

function locationsContract(homeBackend: StoreBackend): void {
  describe(`locations contract: a ${homeBackend} home store`, () => {
    let scratch = "";
    let home = "";
    let session: KbContext | null = null;
    let restoreHome: (() => void) | undefined;
    const servers: { stop: (force: boolean) => unknown }[] = [];
    /** The roots `serve` was asked to start a server for. */
    let started: string[] = [];
    /** What the stand-in `serve` does: start a server answering for the root, unless told to fail. */
    let startFails = false;
    /** Whether `serve` is the real one: a `kb ui` child, stopped after the case. */
    let realServe = false;
    const children: string[] = [];

    /** A server that answers as a `kb ui` serving `root`, named in the root's presence. */
    const answerFor = Effect.fn("locationsContract.answerFor")(function* (root: string) {
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: () => Response.json({ root }),
      });
      servers.push(server);
      const url = `http://127.0.0.1:${server.port}`;
      yield* writeUiPresence(root, url).pipe(Effect.provide(bunFileSystemLayer));
      return url;
    });

    const serve = (root: string): Effect.Effect<string, DomainError> => {
      started.push(root);
      if (realServe) {
        children.push(root);
        const env = childProcessEnv("kb", { KB_PKG_ROOT: join(scratch, "pkg"), KB_HOME: home });
        return serveRoot(root, { command: [process.execPath, CLI], env, timeoutMs: 20_000 }).pipe(
          Effect.provide(bunFileSystemLayer),
        );
      }
      return startFails
        ? domainError("internal", `kb ui for ${root} stopped (exit code 1) before it served`)
        : answerFor(root).pipe(Effect.orDie);
    };

    /** A root holding a store of `backend`, under the scratch directory. */
    const storeRoot = Effect.fn("locationsContract.storeRoot")(function* (
      name: string,
      backend: StoreBackend = "jsonl",
    ) {
      const root = join(scratch, name);
      yield* Effect.promise(() => mkdir(root, { recursive: true }));
      yield* createStore(root, backend).pipe(Effect.provide(bunFileSystemLayer));
      return yield* Effect.promise(() => realpath(root));
    });

    /** Invoke `id` in the session's root, with the home store where the contract put it. */
    const invoke = Effect.fn("locationsContract.invoke")(function* (
      id: string,
      input: unknown,
      actor?: Actor,
    ): Effect.fn.Return<ActionReceipt> {
      if (session === null) throw new Error("no session: beforeEach did not run");
      const ctx = session;
      return yield* Effect.gen(function* () {
        const roots = yield* KbRoots;
        const invocation = actor === undefined ? { id, input } : { id, input, actor };
        return yield* invokeReceiptEffect(ctx, onWire(IN_PROCESS_WIRE, invocation)).pipe(
          Effect.provideService(KbRoots, { ...roots, serve }),
        );
      }).pipe(Effect.provide(kbRuntimeLayer(ctx)));
    });

    const output = Effect.fn("locationsContract.output")(function* (id: string, input: unknown) {
      const receipt = yield* invoke(id, input);
      if (receipt.status !== "succeeded")
        throw new Error(`${id} failed: ${receipt.code} ${receipt.message}`);
      return receipt.output;
    });

    const list = () =>
      output("location.list", {}).pipe(Effect.map((out) => LocationListSchema.parse(out)));
    const register = (path: string) =>
      output("location.register", { path }).pipe(Effect.map((out) => LocationRowSchema.parse(out)));

    /** The home store's nodes, read straight from it. */
    const homeNodes = () => openRoot(home).pipe(Effect.map((ctx) => ctx.nodes));

    beforeEach(() =>
      run(
        Effect.gen(function* () {
          const made = yield* Effect.promise(() =>
            mkdtemp(join(tmpdir(), "kb-locations-contract-")),
          );
          scratch = yield* Effect.promise(() => realpath(made));
          home = join(scratch, "home");
          restoreHome = pointHomeAt(home);
          started = [];
          startFails = false;
          realServe = false;
          yield* Effect.promise(() => mkdir(join(scratch, "pkg")));
          yield* Effect.promise(() => mkdir(home));
          yield* createStore(home, homeBackend).pipe(Effect.provide(bunFileSystemLayer));
          session = yield* openRoot(yield* storeRoot("current"));
        }),
      ),
    );

    afterEach(async () => {
      restoreHome?.();
      for (const server of servers.splice(0)) void server.stop(true);
      for (const root of children.splice(0)) {
        const presence = await run(readUiPresence(root).pipe(Effect.provide(bunFileSystemLayer)));
        if (presence !== null) process.kill(presence.pid, "SIGTERM");
      }
      return rm(scratch, { recursive: true, force: true });
    });

    test("registering is idempotent by canonical path, and a symlinked spelling finds its node", () =>
      run(
        Effect.gen(function* () {
          const root = yield* storeRoot("alpha");
          const first = yield* register(root);
          const link = join(scratch, "alpha-link");
          yield* Effect.promise(() => symlink(root, link));
          const again = yield* register(link);
          expect(again.id).toBe(first.id);
          expect(again.path).toBe(root);
          const rows = (yield* list()).rows.filter((row) => row.path === root);
          expect(rows.map((row) => row.id)).toEqual([first.id]);
        }),
      ));

    test("registering ranks a location first", () =>
      run(
        Effect.gen(function* () {
          const a = yield* register(yield* storeRoot("a"));
          const b = yield* register(yield* storeRoot("b"));
          expect((yield* list()).rows.map((row) => row.id)).toEqual([b.id, a.id]);
          yield* register(a.path);
          expect((yield* list()).rows.map((row) => row.id)).toEqual([a.id, b.id]);
        }),
      ));

    test("forgetting deletes the node and leaves its directory byte for byte", () =>
      run(
        Effect.gen(function* () {
          const root = yield* storeRoot("kept");
          const row = yield* register(root);
          const before = yield* snapshot(root);
          expect(yield* output("location.forget", { id: row.id })).toEqual({
            id: row.id,
            label: row.label,
            path: root,
          });
          expect(yield* snapshot(root)).toEqual(before);
          expect((yield* homeNodes()).some((node) => node.id === row.id)).toBe(false);
          expect((yield* invoke("location.forget", { id: row.id })).status).toBe("failed");
        }),
      ));

    test("status is read from each path", () =>
      run(
        Effect.gen(function* () {
          const jsonl = yield* storeRoot("jsonl", "jsonl");
          const sqlite = yield* storeRoot("sqlite", "sqlite");
          const served = yield* storeRoot("served");
          const gone = yield* storeRoot("gone");
          for (const root of [jsonl, sqlite, served, gone]) yield* register(root);
          // A plain directory holds no store, so registering it is refused.
          const plain = join(scratch, "plain");
          yield* Effect.promise(() => mkdir(plain));
          expect((yield* invoke("location.register", { path: plain })).status).toBe("failed");
          yield* Effect.promise(() => rm(gone, { recursive: true }));
          const url = yield* answerFor(served);

          const byPath = new Map((yield* list()).rows.map((row) => [row.path, row]));
          expect(byPath.get(jsonl)).toMatchObject({ status: "closed", backend: "jsonl" });
          expect(byPath.get(sqlite)).toMatchObject({ status: "closed", backend: "sqlite" });
          expect(byPath.get(served)).toMatchObject({ status: "served", url, backend: "jsonl" });
          expect(byPath.get(gone)).toMatchObject({ status: "missing" });
          expect(byPath.get(gone)?.reason).toContain(gone);
          expect(byPath.get(jsonl)?.current).toBe(false);
          expect(yield* register(session?.root ?? "")).toMatchObject({
            current: true,
            status: "closed",
          });
        }),
      ));

    test("a malformed location lists as broken, and two for one root warn", () =>
      run(
        Effect.gen(function* () {
          const root = yield* storeRoot("twice");
          const row = yield* register(root);
          const plain = join(scratch, "plain");
          yield* Effect.promise(() => mkdir(plain));
          const ctx = yield* openRoot(home);
          yield* ctx.store.commitEffect(
            {
              upserts: [
                taggedByHand("l.none", []),
                taggedByHand("l.two", [root, plain]),
                taggedByHand("l.again", [root]),
                taggedByHand("l.plain", [plain]),
              ],
              deletes: [],
            },
            { at: CONTRACT_AT },
          );
          const listed = yield* list();
          const byId = new Map(listed.rows.map((r) => [r.id, r]));
          expect(byId.get("l.none")).toMatchObject({ status: "broken" });
          expect(byId.get("l.two")).toMatchObject({ status: "broken" });
          expect(byId.get("l.plain")).toMatchObject({ status: "not-a-store" });
          expect(byId.get(row.id)).toMatchObject({ status: "closed" });
          expect(listed.warnings).toEqual([expect.stringContaining("l.again")]);
        }),
      ));

    test("listing writes to no listed store", () =>
      run(
        Effect.gen(function* () {
          const root = yield* storeRoot("read-only");
          yield* register(root);
          const before = yield* snapshot(root);
          yield* list();
          yield* list();
          expect(yield* snapshot(root)).toEqual(before);
        }),
      ));

    test("the tag and the field are minted once", () =>
      run(
        Effect.gen(function* () {
          yield* register(yield* storeRoot("one"));
          yield* register(yield* storeRoot("two"));
          const nodes = yield* homeNodes();
          for (const id of [LOCATION_IDS.tag, LOCATION_IDS.pathField, LOCATION_IDS.list])
            expect(nodes.filter((node) => node.id === id)).toHaveLength(1);
          expect(nodes.find((node) => node.id === LOCATION_IDS.list)?.children).toHaveLength(2);
        }),
      ));

    test("with no home store yet, the list is empty and says where it will be", () =>
      run(
        Effect.gen(function* () {
          yield* Effect.promise(() => rm(home, { recursive: true }));
          const listed = yield* list();
          expect(listed.rows).toEqual([]);
          expect(listed.warnings).toEqual([expect.stringContaining(home)]);
          yield* register(yield* storeRoot("first"));
          expect((yield* list()).rows).toHaveLength(1);
        }),
      ));

    const open = (input: unknown) =>
      output("location.open", input).pipe(Effect.map((out) => LocationOpenedSchema.parse(out)));
    const order = () => list().pipe(Effect.map(({ rows }) => rows.map((row) => row.id)));

    test("opening a served root answers its URL, starts nothing, and ranks it first", () =>
      run(
        Effect.gen(function* () {
          const a = yield* register(yield* storeRoot("a"));
          yield* register(yield* storeRoot("b"));
          const url = yield* answerFor(a.path);
          expect(yield* open({ id: a.id })).toEqual({ url, path: a.path });
          expect(started).toEqual([]);
          expect((yield* order())[0]).toBe(a.id);
        }),
      ));

    test("opening a closed root starts a server for it; a start that fails ranks nothing", () =>
      run(
        Effect.gen(function* () {
          const a = yield* register(yield* storeRoot("a"));
          const b = yield* register(yield* storeRoot("b"));
          startFails = true;
          const refused = yield* invoke("location.open", { id: a.id });
          expect(refused).toMatchObject({ status: "failed", code: "internal" });
          expect(yield* order()).toEqual([b.id, a.id]);
          startFails = false;
          const opened = yield* open({ path: a.path });
          expect(started).toEqual([a.path, a.path]);
          expect(opened.path).toBe(a.path);
          expect((yield* list()).rows.find((row) => row.id === a.id)).toMatchObject({
            status: "served",
            url: opened.url,
          });
        }),
      ));

    test(
      "opening a closed root through the real serve starts a kb ui that answers for it",
      () =>
        run(
          Effect.gen(function* () {
            const a = yield* register(yield* storeRoot("a"));
            const b = yield* register(yield* storeRoot("b"));
            realServe = true;
            const opened = yield* open({ id: a.id });
            expect(opened.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
            const identity = yield* Effect.promise(() =>
              fetch(`${opened.url}/api/identity`).then((res) => res.json()),
            );
            expect(identity).toEqual({ root: a.path });
            expect((yield* list()).rows.find((row) => row.id === a.id)).toMatchObject({
              status: "served",
              url: opened.url,
            });
            expect(yield* order()).toEqual([a.id, b.id]);
          }),
        ),
      30_000,
    );

    test("opening what is missing or not a store fails not_found and starts nothing", () =>
      run(
        Effect.gen(function* () {
          const gone = yield* register(yield* storeRoot("gone"));
          yield* Effect.promise(() => rm(gone.path, { recursive: true }));
          const plain = join(scratch, "plain");
          yield* Effect.promise(() => mkdir(plain));
          for (const input of [{ id: gone.id }, { path: plain }, { id: "no-such-location" }])
            expect(yield* invoke("location.open", input)).toMatchObject({
              status: "failed",
              code: "not_found",
            });
          expect(started).toEqual([]);
        }),
      ));

    test("an agent registers, forgets and opens only with the owner's approval; it lists freely", () =>
      run(
        Effect.gen(function* () {
          const a = yield* register(yield* storeRoot("a"));
          const b = yield* storeRoot("b");
          const before = yield* homeNodes();
          for (const [id, input] of [
            ["location.register", { path: b }],
            ["location.forget", { id: a.id }],
            ["location.open", { id: a.id }],
          ] as const) {
            expect({ id, receipt: yield* invoke(id, input, "agent") }).toMatchObject({
              id,
              receipt: { status: "failed", code: "approval_required" },
            });
          }
          expect(yield* homeNodes()).toEqual(before);
          expect(started).toEqual([]);
          expect((yield* invoke("location.list", {}, "agent")).status).toBe("succeeded");
          expect((yield* invoke("location.open", { id: a.id }, "script")).status).toBe("failed");
        }),
      ));

    test("the root a person opens is registered as a call on their surface's wire", () =>
      run(
        Effect.gen(function* () {
          if (session === null) throw new Error("no session: beforeEach did not run");
          const ctx = session;
          const opened = (actor: Actor) =>
            registerOpenedRoot(ctx, { carriesApproval: true, actor }).pipe(
              Effect.provide(kbRuntimeLayer(ctx)),
            );
          expect(yield* opened("agent")).toContain("approval");
          expect((yield* list()).rows).toEqual([]);
          expect(yield* opened("cli")).toBeNull();
          expect((yield* list()).rows.map(({ path }) => path)).toEqual([ctx.root]);
        }),
      ));

    test("opening nothing opens the home store, made first when there is none", () =>
      run(
        Effect.gen(function* () {
          const opened = yield* open({});
          expect(opened.path).toBe(yield* Effect.promise(() => realpath(home)));
          expect(started).toEqual([opened.path]);
          yield* Effect.promise(() => rm(home, { recursive: true }));
          const made = yield* open({});
          expect(made.path).toBe(opened.path);
          expect((yield* homeNodes()).length).toBeGreaterThan(0);
        }),
      ));
  });
}

for (const backend of STORE_BACKENDS) locationsContract(backend);
