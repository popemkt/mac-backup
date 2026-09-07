/**
 * The JSONL store's durable transaction tail: `<root>/.kb/tx.jsonl`.
 *
 * One canonical-JSON record per line, oldest first, in the same format and
 * with the same durability discipline as `nodes.jsonl` — it is the same kind
 * of file, so it gets one reader, one writer and one crash story rather than a
 * second set of each. It is **not** committed: the nodes are the intent and
 * the order they were written in is state (`docs/backup-strategy.md`).
 *
 * Each record carries `mark`, the store's own durable commit mark —
 * `nodes.jsonl`'s size and mtime, the same string {@link JsonlStore.fingerprint}
 * answers with — read after the node write. That is what makes
 * {@link JsonlTxTail.isCurrent} a comparison rather than a guess: a tail whose
 * last mark is not the file's current one is behind the store, which is the
 * crash window between the two writes made visible instead of assumed away.
 */
import { appendFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { Predicate } from "effect";
import { canonicalJson, decodeStoredTx, domainError, type KbTx, type StoreTx } from "@kb/model";
import type { TxRecord, TxTail } from "@kb/contracts";
import { durableReplaceFile } from "./durable-replace.ts";

/**
 * How many records the tail keeps. A reader further behind than this takes a
 * snapshot — the same bound the in-process ring used to impose, except that it
 * now bounds a file, so an unbounded sequence costs one compaction rather than
 * unbounded disk forever.
 */
export const TX_TAIL_MAX_ENTRIES = 2048;

/** What a compaction leaves, so it does not run again on the next append. */
export const TX_TAIL_KEEP_ENTRIES = 1024;

/** One line of `tx.jsonl`: a {@link KbTx} plus the store mark it was written at. */
interface TailRecord {
  readonly tx: KbTx;
  readonly mark: string;
}

/** `${size}:${mtime}` for a file, or null when it is not there. */
export function fileMark(path: string): string | null {
  try {
    const info = statSync(path);
    return `${String(info.size)}:${String(Math.trunc(info.mtimeMs))}`;
  } catch {
    return null;
  }
}

/** Where the JSONL store keeps its tail. */
export function txTailPath(root: string): string {
  return join(root, ".kb", "tx.jsonl");
}

function markOf(raw: unknown): string {
  return Predicate.hasProperty(raw, "mark") && typeof raw.mark === "string" ? raw.mark : "";
}

export class JsonlTxTail implements TxTail {
  readonly path: string;
  readonly backupPath: string;
  private readonly nodesPath: string;
  /**
   * The parsed file, kept only while the file has not moved.
   *
   * Not a second copy of the sequence: it is keyed by the tail file's own
   * size+mtime, so another process's append invalidates it on the next read.
   * Without it every commit would re-read and re-decode the whole tail on the
   * keystroke path.
   */
  private cache: { mark: string; records: TailRecord[] } | null = null;

  constructor(nodesPath: string, path: string) {
    this.nodesPath = nodesPath;
    this.path = path;
    this.backupPath = `${path}.bak`;
  }

  head(): number {
    return this.records().at(-1)?.tx.rev ?? 0;
  }

  isCurrent(): boolean {
    const last = this.records().at(-1);
    // No tail and no store is a consistent pair: nothing has happened yet.
    if (last === undefined) return fileMark(this.nodesPath) === null;
    return last.mark === fileMark(this.nodesPath);
  }

  entries(): KbTx[] {
    return this.records().map((record) => record.tx);
  }

  append(ops: StoreTx, record: TxRecord): KbTx {
    const existing = this.records();
    const rev = (existing.at(-1)?.tx.rev ?? 0) + 1;
    const tx: KbTx =
      record.origin === undefined
        ? { rev, ops, at: record.at }
        : { rev, ops, at: record.at, origin: record.origin };
    const line: TailRecord = { tx, mark: fileMark(this.nodesPath) ?? "" };

    if (existing.length + 1 > TX_TAIL_MAX_ENTRIES) {
      this.write([...existing.slice(-(TX_TAIL_KEEP_ENTRIES - 1)), line]);
    } else {
      this.appendLine(existing, line);
    }
    return tx;
  }

  adopt(txs: readonly KbTx[]): void {
    const mark = fileMark(this.nodesPath) ?? "";
    this.write(txs.slice(-TX_TAIL_KEEP_ENTRIES).map((tx) => ({ tx, mark })));
  }

  /** The tail as records, from the cache while the file has not moved. */
  private records(): TailRecord[] {
    const mark = fileMark(this.path);
    if (mark === null) {
      this.cache = null;
      return [];
    }
    if (this.cache?.mark === mark) return this.cache.records;
    const records = this.read();
    this.cache = { mark, records };
    return records;
  }

  private read(): TailRecord[] {
    let body: string;
    try {
      body = readFileSync(this.path, "utf8");
    } catch {
      return [];
    }
    const records: TailRecord[] = [];
    for (const line of body.split("\n")) {
      if (line.trim().length === 0) continue;
      try {
        const raw: unknown = JSON.parse(line);
        records.push({ tx: decodeStoredTx(raw), mark: markOf(raw) });
      } catch {
        // A tail is state, not intent: an unreadable record costs the readers
        // after it a snapshot, which the port already has an answer for.
        // Failing the whole load — the right call for `nodes.jsonl`, where the
        // data *is* the repo — would let a corrupt sidecar stop the store.
        return records;
      }
    }
    return records;
  }

  /**
   * Append one line: the cheap path, and the common one.
   *
   * Deliberately not `fsync`ed, unlike the node write beside it. The whole
   * point of the write order is that the tail may lag the store and never lead
   * it, and skipping the flush can only ever make it lag — a power loss that
   * takes the last record leaves exactly the state `isCurrent` already
   * detects, and readers pay one snapshot for it. Paying an `fsync` per commit
   * to shrink a window that is already handled would double the cost of every
   * keystroke for no reachable failure.
   */
  private appendLine(existing: TailRecord[], line: TailRecord): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      appendFileSync(this.path, `${canonicalJson({ ...line.tx, mark: line.mark })}\n`);
    } catch (err) {
      this.cache = null;
      throw domainError(
        "internal",
        `append tx tail ${this.path}: ${err instanceof Error ? err.message : String(err)}`,
        { path: this.path },
      );
    }
    this.cache = { mark: fileMark(this.path) ?? "", records: [...existing, line] };
  }

  /** Replace the whole tail — compaction and {@link JsonlTxTail.adopt}. */
  private write(records: readonly TailRecord[]): void {
    const body = records
      .map((record) => `${canonicalJson({ ...record.tx, mark: record.mark })}\n`)
      .join("");
    try {
      durableReplaceFile(this.path, this.backupPath, body);
    } catch (err) {
      this.cache = null;
      throw err;
    }
    this.cache = { mark: fileMark(this.path) ?? "", records: [...records] };
  }
}
