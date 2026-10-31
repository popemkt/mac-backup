// canvas-link end to end, in a scratch home: link by key, list, unlink by key. Run: node --test tests/
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../canvas-link.mjs", import.meta.url));
const HOST = hostname().split(".")[0].toLowerCase();
const home = mkdtempSync(join(tmpdir(), "canvas-link-"));
after(() => rmSync(home, { recursive: true, force: true }));

// tldraw's recent files, where canvas-link reads them; tldraw itself is not running.
const tldraw = join(home, "Library/Application Support/tldraw");
mkdirSync(tldraw, { recursive: true });
writeFileSync(
  join(tldraw, "recent-files.json"),
  JSON.stringify({
    files: {
      "tldr:file:A": { filePath: join(home, "a.tldraw"), documentId: "doc-a", lastChangedAt: 2 },
      "tldr:file:B": { filePath: join(home, "b.tldraw"), documentId: "doc-b", lastChangedAt: 1 },
    },
  }),
);

function canvasLink(thread, ...args) {
  const env = { PATH: process.env.PATH ?? "", HOME: home, XDG_STATE_HOME: join(home, "state"), BB_THREAD_ID: thread };
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: home, env, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const keys = (thread, scope) => JSON.parse(canvasLink(thread, "ls", scope, "--json").out).canvases.map(c => c.key);

test("add and rm take the key ls prints; rm ends only this thread's link", () => {
  assert.deepEqual(keys("thr_1", "--available"), [`${HOST}:doc-a`, `${HOST}:doc-b`]);
  assert.equal(canvasLink("thr_1", "add", `${HOST}:doc-b`).code, 0);
  assert.equal(canvasLink("thr_2", "add", `${HOST}:doc-b`).code, 0);
  assert.deepEqual(keys("thr_1", "--session"), [`${HOST}:doc-b`]);
  // Linked canvases come first in --available, with their sessions.
  const available = JSON.parse(canvasLink("thr_1", "ls", "--available", "--json").out);
  assert.equal(available.scope, "available");
  assert.deepEqual(available.canvases.map(c => [c.key, c.sessions.length]), [[`${HOST}:doc-b`, 2], [`${HOST}:doc-a`, 0]]);

  const rm = canvasLink("thr_1", "rm", `${HOST}:doc-b`);
  assert.equal(rm.code, 0, rm.err);
  assert.match(rm.out, /^unlinked .*b\.tldraw \(bb:thr_1\)/);
  assert.deepEqual(keys("thr_1", "--session"), []);
  assert.deepEqual(keys("thr_2", "--session"), [`${HOST}:doc-b`]);
  const log = readFileSync(join(home, "state/canvas-links/links.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l));
  assert.deepEqual(log.map(r => r.op), ["link", "link", "unlink"]);
  assert.deepEqual(log[2].canvas, { documentId: "doc-b", path: join(home, "b.tldraw"), host: HOST });
});

test("a path-keyed link is ended by its key", () => {
  const key = `${HOST}:${join(home, "new.tldraw")}`;
  assert.equal(canvasLink("thr_3", "add", key).code, 0);
  assert.deepEqual(keys("thr_3", "--session"), [key]);
  assert.equal(canvasLink("thr_3", "rm", key).code, 0);
  assert.deepEqual(keys("thr_3", "--session"), []);
});

