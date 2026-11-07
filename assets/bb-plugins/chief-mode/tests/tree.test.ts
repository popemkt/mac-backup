// The member index and the roster: a tree rebuilt from metadata alone, the same whether it comes
// from the cache or a full rescan.
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { MAX_PAGES, MemberIndex, PAGE, rebuildMembers } from "../core/members.ts";
import { buildMeta, type RoleMeta } from "../core/model.ts";
import { buildRoster, compareTaskKeys, formatRoster, scopeRoster, type ThreadFacts } from "../core/tree.ts";

const NOW = 1_800_000_000_000;
const coordinator = buildMeta("thr_coord1", { role: "coordinator" }, NOW);
const chief = buildMeta("thr_chief1", { role: "project-chief", projectId: "proj_dotfil", reportsTo: "thr_coord1" }, NOW + 1);
const arch10 = buildMeta("thr_arch10", { role: "architect", projectId: "proj_dotfil", taskKey: "DOT-10", reportsTo: "thr_chief1" }, NOW + 2);
const arch9 = buildMeta("thr_arch09", { role: "architect", projectId: "proj_dotfil", taskKey: "DOT-9", reportsTo: "thr_chief1" }, NOW + 3);

const facts = (id: string, over: Partial<ThreadFacts> = {}): ThreadFacts => ({
  id,
  title: id,
  status: "idle",
  projectId: "proj_dotfil",
  archived: false,
  pending: 0,
  ...over,
});

describe("MemberIndex", () => {
  test("finds by role and link, oldest first", () => {
    const index = new MemberIndex();
    const later = buildMeta("thr_chief2", { role: "project-chief", projectId: "proj_dotfil" }, NOW + 50);
    index.set("thr_chief2", later);
    index.set("thr_chief1", chief);
    index.set("thr_arch10", arch10);
    assert.deepEqual(index.find({ role: "project-chief", projectId: "proj_dotfil" }), ["thr_chief1", "thr_chief2"]);
    assert.deepEqual(index.find({ role: "architect", taskKey: "DOT-10" }), ["thr_arch10"]);
    assert.equal(index.reportsToOf("thr_arch10"), "thr_chief1");
  });

  test("persists and reloads, dropping malformed rows", () => {
    const index = new MemberIndex();
    index.set("thr_chief1", chief);
    const raw = { ...JSON.parse(JSON.stringify(index.toJSON())), thr_bad: { role: "nope" }, notathread: chief };
    const reloaded = MemberIndex.fromJSON(raw);
    assert.deepEqual(reloaded.ids(), ["thr_chief1"]);
    assert.deepEqual(reloaded.get("thr_chief1"), chief);
  });

  test("a write during a rebuild survives the rebuild's older result", () => {
    const index = new MemberIndex();
    index.set("thr_old", chief);
    index.beginRebuild();
    index.set("thr_new01", arch10); // written while the rebuild was reading
    index.set("thr_old", null); // and one removed
    index.replace(new Map<string, RoleMeta>([["thr_old", chief]]));
    assert.deepEqual(index.ids().sort(), ["thr_new01"]);
  });
});

describe("rebuildMembers", () => {
  test("pages through threads and keeps only valid roles", async () => {
    const all = Array.from({ length: PAGE + 3 }, (_, i) => `thr_t${String(i).padStart(4, "0")}`);
    const metadata: Record<string, unknown> = { [all[1]!]: chief, [all[PAGE + 1]!]: arch9, [all[2]!]: { role: "bogus" } };
    const pages: number[] = [];
    const result = await rebuildMembers({
      listThreadIds: async (offset, limit) => {
        pages.push(offset);
        return all.slice(offset, offset + limit);
      },
      listMeta: async (ids) => ids.filter((id) => id in metadata).map((threadId) => ({ threadId, metadata: metadata[threadId] })),
    });
    assert.deepEqual(pages, [0, PAGE]);
    assert.equal(result.scanned, all.length);
    assert.equal(result.truncated, false);
    assert.deepEqual([...result.members.keys()].sort(), [all[1], all[PAGE + 1]].sort());
  });

  test("reports truncation past the page cap", async () => {
    const result = await rebuildMembers({
      listThreadIds: async (offset) => Array.from({ length: PAGE }, (_, i) => `thr_p${offset + i}`),
      listMeta: async () => [],
    });
    assert.equal(result.truncated, true);
    assert.equal(result.scanned, PAGE * MAX_PAGES);
  });
});

describe("buildRoster", () => {
  const roster = buildRoster({
    members: [
      { meta: arch10, thread: facts("thr_arch10", { title: "DOT-10 work", status: "active" }) },
      { meta: arch9, thread: facts("thr_arch09", { title: "DOT-9 work", pending: 1 }) },
      { meta: chief, thread: facts("thr_chief1", { title: "Chief .dotfiles" }) },
      { meta: coordinator, thread: facts("thr_coord1", { title: "Coordinator" }) },
      {
        meta: buildMeta("thr_gone1", { role: "architect", projectId: "proj_dotfil", taskKey: "DOT-1" }, NOW),
        thread: facts("thr_gone1", { archived: true }),
      },
    ],
    tasks: new Map([
      ["DOT-9", { key: "DOT-9", title: "Nine", status: "in_progress" }],
      ["DOT-10", { key: "DOT-10", title: "Ten", status: "todo" }],
    ]),
    projectNames: new Map([["proj_dotfil", ".dotfiles"]]),
  });

  test("coordinator → project → chief and tasks → architects; archived left out", () => {
    assert.deepEqual(
      roster.coordinators.map((m) => m.threadId),
      ["thr_coord1"],
    );
    assert.equal(roster.projects.length, 1);
    const [project] = roster.projects;
    assert.equal(project!.name, ".dotfiles");
    assert.deepEqual(
      project!.chiefs.map((m) => m.threadId),
      ["thr_chief1"],
    );
    assert.deepEqual(
      project!.tasks.map((t) => [t.key, t.title, t.status, t.architects.map((a) => a.threadId)]),
      [
        ["DOT-9", "Nine", "in_progress", ["thr_arch09"]],
        ["DOT-10", "Ten", "todo", ["thr_arch10"]],
      ],
    );
    assert.deepEqual(roster.totals, { members: 4, pending: 1, working: 1 });
  });

  test("text form shows every level and what waits on the person", () => {
    const text = formatRoster(roster);
    assert.match(text, /Coordinator: Coordinator thr_coord1 \[idle\]/u);
    assert.match(text, /Project chief: Chief \.dotfiles thr_chief1/u);
    assert.match(text, /DOT-9 Nine \(in_progress\)/u);
    assert.match(text, /thr_arch09 \[idle, 1 waiting on you\]/u);
    assert.ok(text.indexOf("DOT-9") < text.indexOf("DOT-10"));
  });

  test("scoping keeps the coordinator and one project", () => {
    assert.equal(scopeRoster(roster, "proj_other").projects.length, 0);
    assert.equal(scopeRoster(roster, "proj_other").coordinators.length, 1);
  });

  test("a role with no project link lands in its thread's project", () => {
    const orphan = { ...chief, projectId: null };
    const built = buildRoster({ members: [{ meta: orphan, thread: facts("thr_chief1", { projectId: "proj_kbkbkb" }) }], tasks: new Map(), projectNames: new Map() });
    assert.equal(built.projects[0]!.projectId, "proj_kbkbkb");
  });
});

test("task keys sort by number, not text", () => {
  assert.deepEqual(["DOT-10", "KB-2", "DOT-9"].sort(compareTaskKeys), ["DOT-9", "DOT-10", "KB-2"]);
});
