import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Predicate } from "effect";
import type { StoreFingerprint } from "@kb/contracts";

/**
 * The JSONL store's fingerprint: a hash of exactly the bytes in `nodes.jsonl`.
 *
 * Content, not a stat, because the question it answers — "is this the store I
 * last saw?" — is about content. Size plus mtime misses a same-length write in
 * the same tick; a hash cannot, and it also treats every byte as meaningful,
 * unknown node keys and non-canonical edits included. The same bytes give the
 * same mark, so a write that restores earlier content is, correctly, that
 * earlier store.
 */
export function contentMark(body: string | Uint8Array): StoreFingerprint {
  return createHash("sha256").update(body).digest("hex");
}

/**
 * {@link contentMark} of the file at `path`. A missing file is the empty store
 * — the loader reads it as no nodes, so it carries the empty store's mark —
 * and a file that cannot be read at all has no mark: null compares equal to
 * nothing.
 */
export function storeMark(path: string): StoreFingerprint | null {
  try {
    return contentMark(readFileSync(path));
  } catch (err) {
    return Predicate.hasProperty(err, "code") && err.code === "ENOENT" ? contentMark("") : null;
  }
}
