// canvas-link's rules over plain data. Run: node --test tests/
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  availableCanvases,
  canvasForKey,
  canvasKey,
  currentLinks,
  currentPath,
  findCanvas,
  listCanvases,
  mergeRows,
  normalizeRemote,
  parseKey,
  parseRows,
  recentFiles,
  resolveCanvas,
  sameProject,
  sessionFromEnv,
  ulid,
} from "../lib.mjs";

const DOTFILES = { remote: "github.com/popemkt/dotfiles", root: "/Users/p/.dotfiles" };
const OTHER = { remote: "github.com/popemkt/kb", root: "/Users/p/kb" };

function row(over) {
  return {
    id: "01",
    ts: 1,
    op: "link",
    kind: "tldraw",
    canvas: { documentId: "doc-a", path: "/Users/p/Documents/a.tldraw", host: "mac" },
    session: { harness: "bb", id: "thr_1" },
    project: DOTFILES,
    source: "canvas-link",
    ...over,
  };
}

test("ulid sorts by time and is 26 Crockford characters", () => {
  const zeros = new Uint8Array(16);
  const a = ulid(1_000, zeros);
  const b = ulid(2_000, zeros);
  assert.equal(a.length, 26);
  assert.match(a, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.ok(a < b);
});

test("session: bb wins over the provider CLI it runs, then orca, claude code, codex", () => {
  assert.deepEqual(sessionFromEnv({ BB_THREAD_ID: "thr_1", CLAUDE_CODE_SESSION_ID: "c" }), { harness: "bb", id: "thr_1" });
  assert.deepEqual(sessionFromEnv({ ORCA_AGENT_SESSION_ID: "o", CLAUDE_CODE_SESSION_ID: "c" }), { harness: "orca", id: "o" });
  assert.deepEqual(sessionFromEnv({ ORCA_PANE_KEY: "pane" }), { harness: "orca", id: "pane" });
  assert.deepEqual(sessionFromEnv({ CLAUDE_CODE_SESSION_ID: "c" }), { harness: "claude-code", id: "c" });
  assert.deepEqual(sessionFromEnv({ CODEX_THREAD_ID: "x" }), { harness: "codex", id: "x" });
  assert.deepEqual(sessionFromEnv({ BB_THREAD_ID: "" }), { harness: "shell", id: null });
});

test("remotes normalize across ssh, scp and https forms", () => {
  for (const url of [
    "git@github.com:popemkt/dotfiles.git",
    "https://github.com/popemkt/dotfiles",
    "https://user@github.com/popemkt/dotfiles.git/",
    "ssh://git@github.com:22/popemkt/dotfiles.git",
    "https://GitHub.com/popemkt/dotfiles",
  ])
    assert.equal(normalizeRemote(url), "github.com/popemkt/dotfiles", url);
  assert.equal(normalizeRemote(null), null);
  assert.equal(normalizeRemote(""), null);
});

test("projects match by remote, or by root when neither has a remote", () => {
  assert.ok(sameProject(DOTFILES, { remote: DOTFILES.remote, root: "/elsewhere/worktree" }));
  assert.ok(!sameProject(DOTFILES, OTHER));
  assert.ok(sameProject({ remote: null, root: "/x" }, { remote: null, root: "/x" }));
  assert.ok(!sameProject({ remote: null, root: "/x" }, { remote: "r", root: "/x" }));
});

test("a torn last line and foreign lines are skipped", () => {
  const good = JSON.stringify(row({}));
  const rows = parseRows(`${good}\n{"id":"x"}\nnot json\n${good.slice(0, 20)}`);
  assert.equal(rows.length, 1);
});

test("merge is a set union by id in (ts, host, id) order", () => {
  const a = row({ id: "b", ts: 2 });
  const b = row({ id: "a", ts: 2, canvas: { documentId: "doc-b", path: null, host: "linux" } });
  const c = row({ id: "c", ts: 1 });
  const merged = mergeRows([a, c], [b, a, c]);
  assert.deepEqual(merged.map(r => r.id), ["c", "a", "b"]);
  assert.deepEqual(mergeRows([b, a, c]), mergeRows([c], [a, b]));
});

test("the last op per (canvas, session) wins", () => {
  const rows = [
    row({ id: "1", ts: 1 }),
    row({ id: "2", ts: 2, op: "unlink" }),
    row({ id: "3", ts: 3, session: { harness: "bb", id: "thr_2" } }),
  ];
  assert.deepEqual(currentLinks(rows).map(r => r.id), ["3"]);
  assert.deepEqual(currentLinks([...rows, row({ id: "4", ts: 4 })]).map(r => r.id).sort(), ["3", "4"]);
});

test("scopes: session, project, all; one entry per canvas with every session", () => {
  const rows = [
    row({ id: "1", ts: 1 }),
    row({ id: "2", ts: 2, session: { harness: "bb", id: "thr_2" } }),
    row({ id: "3", ts: 3, canvas: { documentId: "doc-b", path: "/b.tldraw", host: "mac" }, session: { harness: "codex", id: "x" }, project: OTHER }),
  ];
  const me = { harness: "bb", id: "thr_1" };
  const session = listCanvases(rows, { scope: "session", session: me, project: DOTFILES });
  assert.deepEqual(session.map(c => c.key), ["mac:doc-a"]);
  const project = listCanvases(rows, { scope: "project", session: me, project: DOTFILES });
  assert.equal(project.length, 1);
  assert.deepEqual(project[0].sessions.map(s => s.id), ["thr_1", "thr_2"]);
  const all = listCanvases(rows, { scope: "all", session: me, project: DOTFILES });
  assert.deepEqual(all.map(c => c.key), ["mac:doc-b", "mac:doc-a"]);
});

test("a canvas without a document id is keyed by host and path", () => {
  assert.equal(canvasKey({ documentId: null, path: "/x.tldraw", host: "mac" }), "mac:/x.tldraw");
});

const RECENT = recentFiles({
  version: "2.0.0",
  files: {
    "tldr:file:A": { workingCopyKey: "tldr:file:A", filePath: "/Users/p/Documents/renamed.tldraw", documentId: "doc-a", lastChangedAt: 5 },
    broken: { nope: true },
  },
});

test("recent files and open docs resolve paths and ids", () => {
  assert.equal(RECENT.length, 1);
  assert.deepEqual(resolveCanvas("/Users/p/Documents/renamed.tldraw", { isPath: true, recent: RECENT }), {
    documentId: "doc-a",
    path: "/Users/p/Documents/renamed.tldraw",
  });
  assert.deepEqual(resolveCanvas("/new.tldraw", { isPath: true, recent: RECENT }), { documentId: null, path: "/new.tldraw" });
  assert.deepEqual(resolveCanvas("tldr:file:A", { isPath: false, recent: RECENT }), { documentId: "doc-a", path: "/Users/p/Documents/renamed.tldraw" });
  assert.equal(resolveCanvas("doc-z", { isPath: false, recent: RECENT }), null);
  assert.deepEqual(resolveCanvas("doc-z", { isPath: false, recent: RECENT, docs: [{ id: "w", documentId: "doc-z", path: "/z.tldraw" }] }), {
    documentId: "doc-z",
    path: "/z.tldraw",
  });
});

test("the current path follows a rename through the document id", () => {
  assert.equal(currentPath({ documentId: "doc-a", path: "/Users/p/Documents/a.tldraw" }, RECENT), "/Users/p/Documents/renamed.tldraw");
  assert.equal(currentPath({ documentId: null, path: "/x.tldraw" }, RECENT), "/x.tldraw");
});

test("open keys: listed key, document id, or path", () => {
  const canvases = listCanvases([row({})], { scope: "all" });
  assert.equal(findCanvas(canvases, "mac:doc-a")?.key, "mac:doc-a");
  assert.equal(findCanvas(canvases, "doc-a")?.key, "mac:doc-a");
  assert.equal(findCanvas(canvases, "/Users/p/Documents/a.tldraw")?.key, "mac:doc-a");
  assert.equal(findCanvas(canvases, "nope"), null);
});

test("keys split into host and document id or path; tldraw's working-copy keys are not keys", () => {
  assert.deepEqual(parseKey("mac:doc-a"), { host: "mac", documentId: "doc-a", path: null });
  assert.deepEqual(parseKey("Linux.local:/x/y.tldraw"), { host: "linux.local", documentId: null, path: "/x/y.tldraw" });
  assert.equal(parseKey("tldr:file:A"), null);
  assert.equal(parseKey("doc-a"), null);
  assert.equal(parseKey("/Users/p/a.tldraw"), null);
});

test("a key resolves to the canvas the log knows, else tldraw's recent files on this host, else as it reads", () => {
  // The listed canvas keeps its latest path, so an unlink row matches the link it ends.
  const canvases = listCanvases([row({})], { scope: "all" });
  assert.deepEqual(canvasForKey("mac:doc-a", { canvases, recent: [], host: "linux" }), {
    documentId: "doc-a",
    path: "/Users/p/Documents/a.tldraw",
    host: "mac",
  });
  assert.deepEqual(canvasForKey("mac:doc-a", { canvases: [], recent: RECENT, host: "mac" }), {
    documentId: "doc-a",
    path: "/Users/p/Documents/renamed.tldraw",
    host: "mac",
  });
  assert.deepEqual(canvasForKey("mac:/Users/p/Documents/renamed.tldraw", { canvases: [], recent: RECENT, host: "mac" }), {
    documentId: "doc-a",
    path: "/Users/p/Documents/renamed.tldraw",
    host: "mac",
  });
  assert.deepEqual(canvasForKey("other:doc-q", { canvases, recent: RECENT, host: "mac" }), { host: "other", documentId: "doc-q", path: null });
  assert.equal(canvasForKey("doc-a", { canvases, recent: RECENT, host: "mac" }), null);
});

test("available: every linked canvas, then the recent files nobody linked, newest change first", () => {
  const recent = recentFiles({
    files: {
      a: { filePath: "/Users/p/Documents/a.tldraw", documentId: "doc-a", lastChangedAt: 9 },
      b: { filePath: "/Users/p/b.tldraw", documentId: "doc-b", lastChangedAt: 1 },
      c: { filePath: "/Users/p/c.tldraw", lastChangedAt: 4 },
    },
  });
  const linked = listCanvases([row({})], { scope: "all" });
  const all = availableCanvases(linked, recent, "mac");
  assert.deepEqual(all.map(c => c.key), ["mac:doc-a", "mac:/Users/p/c.tldraw", "mac:doc-b"]);
  assert.deepEqual(all[2], { key: "mac:doc-b", documentId: "doc-b", path: "/Users/p/b.tldraw", host: "mac", linkedAt: null, sessions: [], projects: [] });
  // Another machine's recent files are not this one's: a canvas linked on "mac" does not hide linux's copy.
  assert.equal(availableCanvases(linked, recent, "linux").length, 4);
});
