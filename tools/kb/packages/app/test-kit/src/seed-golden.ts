/**
 * The seed golden: a fresh store's system nodes, as kb shipped them before
 * the extension families took their own (DESIGN.md → Extension families →
 * the seed is the bundled fold), stamped at {@link CONTRACT_AT} and written
 * in the store's file format — one whole node per line, keyed by id, so a
 * parent's `children` order is part of it.
 *
 * It is the proof that moving a family's ids does not move its nodes: the
 * golden test holds the fold to it byte for byte, and the store contract
 * opens a store written from it and expects no write. It changes only in the
 * commit that changes the seed on purpose.
 */
import { readFileSync } from "node:fs";
import { decodeStoredNode, type KbNode } from "@kb/model";

/** Where the golden lives, beside this module. */
const SEED_GOLDEN_FILE = new URL("./seed.golden.jsonl", import.meta.url);

/** The golden as bytes: what a fresh store's seed is in the store's file format. */
export function seedGolden(): string {
  return readFileSync(SEED_GOLDEN_FILE, "utf8");
}

/** The golden as nodes: a store written by the seed kb shipped. */
export function seedGoldenNodes(): KbNode[] {
  return seedGolden()
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => decodeStoredNode(JSON.parse(line)));
}
