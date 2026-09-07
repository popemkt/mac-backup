/**
 * SqliteStore against the shared store and log contracts. The properties live
 * in `@kb/test-kit` because they are the ports', not this adapter's; what is
 * specific to sqlite — the schema, the write-lock failure, the `rev` half of
 * the fingerprint — is in `sqlite-store.test.ts`.
 */
import { Database } from "bun:sqlite";
import { logContract, storeContract } from "@kb/test-kit";
import { SqliteStore, sqliteStorePath } from "../src/index.ts";

storeContract("SqliteStore", (root) => new SqliteStore(root));

logContract("SqliteStore", {
  makeStore: (root) => new SqliteStore(root),
  // A row out of the table. On this backend the record and the node rows are
  // one transaction, so no crash can actually produce this state — which is
  // why it has to be injected to prove the detection works at all.
  dropLastRecord: (root) =>
    withRawDb(root, (db) => {
      db.run("DELETE FROM tx WHERE rev = (SELECT MAX(rev) FROM tx)");
    }),
  // A trigger that aborts every insert — the same injection `s1` used for the
  // mid-write commit failure, and the only honest one on a backend where the
  // write cannot fail at the filesystem.
  breakTail: (root) =>
    withRawDb(root, (db) => {
      db.run("CREATE TRIGGER tx_readonly BEFORE INSERT ON tx BEGIN SELECT RAISE(ABORT, 'no'); END");
    }),
});

/** A second connection to the store's file, for the two injections above. */
function withRawDb(root: string, run: (db: Database) => void): void {
  const db = new Database(sqliteStorePath(root));
  try {
    run(db);
  } finally {
    db.close(false);
  }
}
