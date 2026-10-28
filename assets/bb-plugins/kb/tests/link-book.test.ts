// The link book over node:sqlite and a fake kb: reading the log of thread writes in pages from a cursor, what
// links what, scopes, links by hand, names and deletions from anyone, a log that skipped ahead, and pruning.
import { strict as assert } from "node:assert";
import { DatabaseSync } from "node:sqlite";
import { describe, test } from "node:test";
import { MIGRATIONS, linkBook, type KbReader, type Sql, type Where } from "../lib/link-book.ts";
import { rowOf } from "../lib/links.ts";

const CANVAS = "sys.tag.canvas";
type Tx = { rev: number; at: string; via?: string; wrote: { id: string; text: string; tags: string[] }[]; deleted: string[] };

/** kb's graph.changes and graph.query as far as the book reads them, over an in-memory log. */
class FakeKb implements KbReader {
  txs: Tx[] = [];
  head = 0;
  canvases = new Map<string, string>();
  changesCalls: Record<string, unknown>[] = [];
  private clock = Date.parse("2026-10-25T00:00:00.000Z");

  write(via: string | undefined, id: string, text: string, tags: string[] = [CANVAS]) {
    if (tags.includes(CANVAS)) this.canvases.set(id, text);
    this.txs.push({ rev: ++this.head, at: new Date((this.clock += 60_000)).toISOString(), via, wrote: [{ id, text, tags }], deleted: [] });
  }

  delete(via: string | undefined, id: string) {
    this.canvases.delete(id);
    this.txs.push({ rev: ++this.head, at: new Date((this.clock += 60_000)).toISOString(), via, wrote: [], deleted: [id] });
  }

  /** Compaction: the log keeps only revs from `rev` on. */
  compactTo(rev: number) {
    this.txs = this.txs.filter(t => t.rev >= rev);
  }

  async root() {
    return "/srv/kb/home";
  }

  async call(id: string, input: Record<string, unknown>) {
    if (id === "graph.query") return { ok: true as const, output: { rows: [...this.canvases] } };
    if (id !== "graph.changes") return { ok: false as const, message: `no ${id}` };
    this.changesCalls.push(input);
    const since = input.since as number;
    const prefix = input.viaPrefix as string | undefined;
    const limit = input.limit as number;
    if (this.txs.length > 0 && since < this.txs[0].rev - 1) return { ok: true as const, output: { head: this.head, through: this.head, complete: false, changes: [] } };
    const read = this.txs.filter(t => t.rev > since).slice(0, limit);
    const changes = read.filter(t => prefix === undefined || (t.via ?? "").startsWith(prefix));
    return { ok: true as const, output: { head: this.head, through: read.at(-1)?.rev ?? this.head, complete: true, changes } };
  }
}

function setup({ page = 500, linksMax = 5000, places = {} as Record<string, Where> } = {}) {
  const db = new DatabaseSync(":memory:");
  for (const m of MIGRATIONS) db.exec(m);
  const kb = new FakeKb();
  const sql = db as unknown as Sql;
  const book = linkBook(sql, kb, async id => places[id] ?? { project: null, host: null }, { page, linksMax });
  const label = (store: string) => store.split("/").at(-1) ?? store;
  return {
    db,
    kb,
    book,
    list: (thread: string, scope: "session" | "project" | "all") => book.list(thread, scope, label),
    available: (thread: string) => book.available(thread, label),
  };
}

describe("reading kb's log of thread writes", () => {
  test("a thread's canvas writes link it; others' writes and plain nodes do not; pages resume at the cursor", async () => {
    const { kb, list, book } = setup({ page: 2 });
    kb.write("bb:thr_a", "c1", "Roadmap");
    kb.write("cron:nightly", "c2", "Cron board");
    kb.write("bb:thr_a", "n1", "a note", []);
    kb.write("bb:thr_b", "c1", "Roadmap v2");
    kb.write(undefined, "c3", "Someone's board");

    const mine = await list("thr_a", "session");
    assert.equal(mine.error, null);
    assert.deepEqual(mine.items.map(i => [i.id, i.name, i.threads.map(t => t.id)]), [["c1", "Roadmap v2", ["thr_a"]]]);
    const all = await list("thr_a", "all");
    assert.deepEqual(all.items.map(i => [i.id, i.threads.map(t => t.id).sort()]), [["c1", ["thr_a", "thr_b"]]]);

    assert.ok(kb.changesCalls.length >= 3, "five revs in pages of two");
    assert.ok(kb.changesCalls.every(c => c.viaPrefix === "bb:" && c.limit === 2));
    kb.changesCalls = [];
    await book.sync();
    assert.deepEqual(kb.changesCalls.map(c => c.since), [5]);
  });

  test("Project shows what threads in the same bb project linked", async () => {
    const places = { thr_a: { project: "p1", host: "mac" }, thr_b: { project: "p2", host: null }, thr_c: { project: "p1", host: null } };
    const { kb, list } = setup({ places });
    kb.write("bb:thr_a", "c1", "One");
    kb.write("bb:thr_b", "c2", "Two");
    assert.deepEqual((await list("thr_c", "project")).items.map(i => i.id), ["c1"]);
    assert.deepEqual((await list("thr_c", "session")).items, []);
  });

  test("a link by hand stays one, is not claimed, and is no edit; a write's link is claimed", async () => {
    const { kb, list, book } = setup();
    await book.link("/srv/kb/home", "canvas", "c9", "Plan", "thr_a", "linked", Date.parse("2026-10-24T00:00:00.000Z"));
    kb.canvases.set("c9", "Plan");
    let [item] = (await list("thr_a", "session")).items;
    assert.equal(item.editedAt, null);
    assert.deepEqual(rowOf(item, "thr_a").notes, ["linked by hand"]);

    kb.write("bb:thr_a", "c9", "Plan");
    kb.write("bb:thr_b", "c9", "Plan");
    [item] = (await list("thr_a", "all")).items;
    assert.notEqual(item.editedAt, null);
    const row = rowOf(item, "thr_a");
    assert.deepEqual(row.notes, ["linked by hand"]);
    assert.deepEqual(row.threads.map(t => [t.id, t.claimed]).sort(), [["thr_a", false], ["thr_b", true]]);
    assert.deepEqual(rowOf(item, "thr_b").notes, ["claimed by this thread"]);
  });

  test("names and deletions come from kb as it is now, whoever made them", async () => {
    const { kb, list } = setup();
    kb.write("bb:thr_a", "c1", "Roadmap");
    kb.write("bb:thr_a", "c2", "Sketch");
    kb.write(undefined, "c1", "Roadmap (renamed in kb)");
    kb.delete(undefined, "c2");
    const items = (await list("thr_a", "session")).items;
    assert.deepEqual(items.map(i => [i.id, i.name, i.gone]).sort(), [
      ["c1", "Roadmap (renamed in kb)", false],
      ["c2", "Sketch", true],
    ]);
  });

  test("a log compacted past the cursor carries on from its head and says links may be missing", async () => {
    const { kb, list } = setup();
    kb.write("bb:thr_a", "c1", "Roadmap");
    assert.equal((await list("thr_a", "session")).incomplete, null);
    kb.write("bb:thr_a", "c2", "Missed");
    kb.write("bb:thr_a", "c3", "Also missed");
    kb.compactTo(3);
    const after = await list("thr_a", "session");
    assert.equal(typeof after.incomplete, "number");
    assert.deepEqual(after.items.map(i => i.id), ["c1"]);
    kb.write("bb:thr_a", "c4", "Seen again");
    const later = await list("thr_a", "session");
    assert.ok(later.items.some(i => i.id === "c4"));
    assert.equal(later.incomplete, after.incomplete, "the gap is remembered");
  });

  test("a first read of a compacted log is no gap: nothing was promised yet", async () => {
    const { kb, list } = setup();
    kb.write("bb:thr_a", "c1", "Old");
    kb.write("bb:thr_a", "c2", "Kept");
    kb.compactTo(2);
    assert.equal((await list("thr_a", "session")).incomplete, null);
  });

  test("only the newest links are kept, and only items something links", async () => {
    const { kb, list, db } = setup({ linksMax: 2 });
    kb.write("bb:thr_a", "c1", "One");
    kb.write("bb:thr_a", "c2", "Two");
    kb.write("bb:thr_a", "c3", "Three");
    assert.deepEqual((await list("thr_a", "session")).items.map(i => i.id), ["c3", "c2"]);
    assert.deepEqual(db.prepare("SELECT id FROM items ORDER BY id").all().map(r => r.id), ["c2", "c3"]);
  });

  test("kb that cannot be read lists what the book has, and says why", async () => {
    const { kb, list } = setup();
    kb.write("bb:thr_a", "c1", "Roadmap");
    await list("thr_a", "session");
    kb.call = async () => ({ ok: false as const, message: "socket closed" });
    const stale = await list("thr_a", "session");
    assert.match(stale.error ?? "", /socket closed/);
    assert.deepEqual(stale.items.map(i => i.id), ["c1"]);
  });

  test("unlink ends only the thread's own link, made by hand or by its writes, and a later write links again", async () => {
    const { kb, list, book, db } = setup();
    kb.write("bb:thr_a", "c1", "Roadmap");
    kb.write("bb:thr_b", "c1", "Roadmap");
    await book.link("/srv/kb/home", "canvas", "c2", "Plan", "thr_a", "linked", Date.parse("2026-10-24T00:00:00.000Z"));
    kb.canvases.set("c2", "Plan");
    await list("thr_a", "session");

    assert.equal(book.unlink("/srv/kb/home", "c1", "thr_a"), true);
    assert.equal(book.unlink("/srv/kb/home", "c2", "thr_a"), true);
    assert.equal(book.unlink("/srv/kb/home", "c2", "thr_a"), false, "nothing left to end");
    assert.deepEqual((await list("thr_a", "session")).items, []);
    assert.deepEqual((await list("thr_b", "session")).items.map(i => i.id), ["c1"]);
    // An item nothing links any more is forgotten; one another thread links stays.
    assert.deepEqual(db.prepare("SELECT id FROM items ORDER BY id").all().map(r => r.id), ["c1"]);

    kb.write("bb:thr_a", "c1", "Roadmap");
    assert.deepEqual((await list("thr_a", "session")).items.map(i => i.id), ["c1"]);
  });

  test("available: every linked canvas with its threads, then the canvases nobody linked, by name", async () => {
    const { kb, available } = setup();
    kb.write("bb:thr_a", "c1", "Roadmap");
    kb.canvases.set("c8", "Zebra board");
    kb.canvases.set("c7", "Atlas");
    const all = await available("thr_b");
    assert.equal(all.error, null);
    assert.deepEqual(all.items.map(i => [i.id, i.name, i.threads.map(t => t.id), i.linkedAt === null]), [
      ["c1", "Roadmap", ["thr_a"], false],
      ["c7", "Atlas", [], true],
      ["c8", "Zebra board", [], true],
    ]);
    assert.equal(rowOf(all.items[1], "thr_b").linkedAt, null);
  });
});
