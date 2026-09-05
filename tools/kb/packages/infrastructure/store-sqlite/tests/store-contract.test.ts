/**
 * SqliteStore against the shared store contract. The properties live in
 * `@kb/test-kit` because they are the port's, not this adapter's; what is
 * specific to sqlite — the schema, the write-lock failure, the `rev` half of
 * the fingerprint — is in `sqlite-store.test.ts`.
 */
import { storeContract } from "@kb/test-kit";
import { SqliteStore } from "../src/index.ts";

storeContract("SqliteStore", (root) => new SqliteStore(root));
