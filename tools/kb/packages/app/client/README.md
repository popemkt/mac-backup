# @kb/client

kb's graph as a library, for a tool that lives outside kb's own surfaces. It
opens the store under a root — `.kb/kb.sqlite` when that is there,
`.kb/nodes.jsonl` otherwise, chosen by the same `selectStore` every kb surface
uses — and offers three calls: read, query, and a conditional commit. It loads no extensions, starts no server, and seeds or
migrates nothing; reading never writes.

```ts
import { openClient } from "@kb/client";

const graph = await openClient(projectRoot);
const before = await graph.snapshot();
const after = await graph.commit({
  expectedRevision: before.revision,
  upserts: [node],
  deletes: [],
  origin: "my-tool",
});
const { rows } = await graph.query("[:find ?id :where [?n :node/id ?id]]");
```

- **`revision` is the store's fingerprint** (`EffectStore.fingerprint`), not a
  second token: for JSONL, the hash of `nodes.jsonl`'s bytes, so identical
  content has the identical revision; for sqlite, the change counter the
  database's triggers keep, which moves on every write. Either way it names
  the state, so a revision read by one client is valid in another. `snapshot()` and `query()` return the revision of
  exactly the nodes they read.
- **`commit()` is the store's conditional commit.** The batch is decoded,
  checked as a whole graph against the snapshot it names (`txIntegrityError`),
  and handed to the store with that fingerprint as its condition, which the
  store re-checks under its own lock. A `KbClientError` with code `conflict`
  means the store moved; nothing was written or recorded, so read again and
  reconsider. `invalid_input` means the batch itself is wrong. Upserts replace
  whole nodes, so keep the fields you do not own when editing a shared node.
- A successful batch is recorded on the transaction tail like any other
  commit, with its `origin`.

The published boundary is plain data, Promises and `KbClientError`, declared in
`src/api.d.ts`; `tests/api.test.ts` holds those declarations to kb's node model
at compile time. `bun run build` bundles the client and its runtime into
`tools/kb/out/client` (gitignored) with those declarations, so a separate
workspace can depend on it without adopting kb's workspace or its Effect
version.
