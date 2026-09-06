import { join } from "node:path";

/** The database file itself: the one path whose presence selects this adapter. */
export function sqliteStorePath(root: string): string {
  return join(root, ".kb", "kb.sqlite");
}

/**
 * Every file this adapter owns under a root, database first, then the
 * write-ahead log, then the shared-memory index.
 *
 * One list, three readers: the store watches the first two (`-shm` is mapped
 * memory, not a change signal), a migration deletes all three so that "is a
 * sqlite store present?" has one answer the moment it returns, and the
 * gitignore check names the same files. Spelling `-wal` at three call sites is
 * how one of them ends up missing it.
 */
export function sqliteStoreFiles(root: string): readonly string[] {
  const db = sqliteStorePath(root);
  return [db, `${db}-wal`, `${db}-shm`];
}
