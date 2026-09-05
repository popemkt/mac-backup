# s1-sqlite-store — a second EffectStore, chosen by presence, proven by the same contract test

Wave `s1` of `docs/kb/waves/2026-09-07/plan.md` (Decision 4). Harness: claude
(opus, high). Branch from `main` @ `bd2303b`. You own: a **new**
`tools/kb/packages/infrastructure/store-sqlite/**` (`scope:backend`), the store
contract test you move into `tools/kb/packages/app/test-kit/**`, the store
selection in `tools/kb/packages/app/runtime/src/layers.ts` (`openKbEffect`,
:64 `new JsonlStore(root)`), one action `store.migrate` in
`tools/kb/packages/application/operations/**` **only if** it can be written
against the `EffectStore` port alone (else it lives in `app/cli` — say which
and why), `kb init --store <jsonl|sqlite>` in `app/cli`, the `EffectStore` doc
comment in `contracts/src/store.ts` if it stops being true, a
`tools/kb/DESIGN.md` section (spec-first: write it before the code), and your
report. `@kb/store-jsonl` you may only touch to delete its now-shared
contract test.

Read first: `contracts/src/store.ts` (the port; note the fingerprint contract
and the gap `01M1PK5NYA7ZG3XC0H0YRYRVZE` it carries), `store-jsonl/src/*`
(lock, durable replace, canonical JSON, `decodeNodes`), its
`tests/store-roundtrip.property.test.ts` and `tests/benchmark.test.ts`,
`runtime/src/layers.ts`, `operations/src/session.ts` :30-100 (`noteStoreSynced`,
the fingerprint `seen` map), `server/src/server.ts` :83 `ingestExternalWrite`
and the file watcher it hangs off, `model/src/tx.ts` (`StoreTx`),
`harness/src/constraints.ts` (`RUNTIME_ONLY_SPECIFIERS` — `bun:sqlite` is
allowed in `scope:backend`, never in `shared`), `tools/kb/AGENTS.md` (Effect
v4). Run `intent/gate.sh session claude-code` first.

## Why

The port was designed for a second adapter and has never had one; a port with
one implementation is an assumption wearing an interface. `SqliteStore` is
also the honest base for service mode (many writers, a durable log later) —
but this wave only proves the port and makes the choice explicit. Nothing
about the index or the log changes.

## Shape

`@kb/store-sqlite` (`bun:sqlite`; deps `@kb/contracts`, `@kb/model`, `effect`;
no `@effect/platform-bun` unless you need `FileSystem` for `exists`):

- File `<root>/.kb/kb.sqlite`. Schema: `nodes(id TEXT PRIMARY KEY, body TEXT NOT NULL)`
  with `body` the same `canonicalJson(node)` the JSONL writes, and
  `meta(key TEXT PRIMARY KEY, value TEXT)` holding `schema_version` and `rev`
  (a counter this store increments per commit). WAL mode, `synchronous=NORMAL`.
- `loadEffect`: `SELECT body … ORDER BY id`, decode with `KbNodeSchema` +
  `nodeParseOptions` exactly as `decodeNodes` does — **export `decodeNodes`'s
  per-line decoder from `@kb/model` if it is not already reachable**, do not
  copy it. Load is all-or-nothing like JSONL.
- `commitEffect(tx)`: one `BEGIN IMMEDIATE … COMMIT` transaction: deletes,
  upserts, `rev += 1`. No `.lock` file — sqlite's own lock is the lock.
- `fingerprint`: `${rev}:${PRAGMA data_version}` — `rev` sees this
  connection's commits, `data_version` sees other connections'. Null when the
  file does not exist. This closes the size+mtime blind spot for sqlite; the
  JSONL gap stays JSONL's.
- Errors map to `DomainError` (`internal`, `invalid_input` for a bad row with
  the row id in `details`).
- Connection lifetime: open lazily on first use, keep open; expose `close()`
  for tests. Say in DESIGN.md why the store, not the caller, owns it.

Selection (`layers.ts` `openKbEffect`): a function `selectStore(root)` in the
runtime package returns `JsonlStore | SqliteStore` by presence of
`.kb/kb.sqlite`; both present ⇒ `domainError("invalid_state", …)` naming both
paths. Presence, not config, because there is nothing else to configure and a
file that exists is the least-surprising switch. Hosts other than the runtime
that construct `new JsonlStore` today (grep found only tests and the two bins
through `openKb`) need no change.

Migration: `store.migrate` `{ to: "sqlite" | "jsonl" }` — load from the
present store, commit everything into the other, delete the source file(s)
(`nodes.jsonl` + `.bak` or `kb.sqlite` + `-wal`/`-shm`) so presence stays
unambiguous. Refuse when the target exists. `kb init --store sqlite` creates
an empty sqlite store instead of an empty JSONL.

Contract test: move `store-roundtrip.property.test.ts`'s properties into
`@kb/test-kit` as `storeContract(name, makeStore: (dir) => EffectStore)` — a
`describe` block each adapter's test file calls with its factory. Properties:
load∘commit round-trip on arbitrary node sets; commit is atomic under a
failure injected mid-write (sqlite: a second connection holding a write
lock ⇒ `commitEffect` fails with `DomainError`, store unchanged); fingerprint
changes on every commit and is stable across pure loads; an external
connection's write changes the fingerprint. The JSONL package keeps only
its adapter-specific tests (lock file, `.bak` rotation, malformed line
numbering). Run the existing benchmark against sqlite too and put the table in
your report; do not assert on it.

Watcher: `server.ts` watches `nodes.jsonl`; with sqlite it must watch
`kb.sqlite` (and `-wal`). Put the watched paths **on the store**
(`EffectStore.watchPaths: readonly string[]`, JSONL = `[path]`) rather than a
second `if` in the server — the server asks the store what to watch.

## Commits

1. `docs(kb): DESIGN.md — SqliteStore, selection by presence, watch paths on the store`
2. `refactor(kb): store contract test lives in test-kit; both adapters run it` (JSONL only, behaviour-preserving — tests already green prove it)
3. `feat(kb): @kb/store-sqlite` (adapter + contract test wired + benchmark)
4. `feat(kb): store selected by presence; store.migrate; kb init --store`

## Report

`docs/kb/waves/2026-09-07/reports/s1.md`: the schema, the fingerprint
argument, the migrate round-trip proven both ways on a copy of the live
`.kb/` (copy it into your scratch dir — never run migrate on the repo's
`.kb/`), the benchmark table jsonl vs sqlite, what `bun run verify` /
`bun test packages` / `bun run test:ui` said, and gaps you met (SQL-backed
`KbIndex`, durable log as a table) filed as `#gap` nodes with ids in the report.
