// The panel's rules over plain data. Run: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { ago, elsewhereHost, matches, otherHarnesses, parseListing, threadIds, timeLabel, type Canvas } from "../lib/canvases.ts";

function canvas(over: Partial<Canvas>): Canvas {
  return {
    key: "mac:doc-a",
    documentId: "doc-a",
    path: "/Users/p/Documents/canvas-links design.tldraw",
    host: "mac",
    name: "canvas-links design",
    folder: "~/Documents",
    local: true,
    exists: true,
    open: false,
    editedAt: null,
    linkedAt: 0,
    sessions: [],
    projects: [],
    ...over,
  };
}

test("a listing is parsed field by field; a broken row is dropped, not the listing", () => {
  const listing = parseListing(
    JSON.stringify({
      scope: "project",
      host: "mac",
      session: { harness: "bb", id: "thr_1" },
      project: { remote: "github.com/p/d", root: "/d" },
      central: "ok",
      canvases: [
        { key: "mac:doc-a", host: "mac", name: "A", sessions: [{ harness: "bb", id: "thr_1", ts: 5 }], linkedAt: 5, open: true, extra: 1 },
        { name: "no key" },
        "junk",
      ],
    }),
  );
  assert.equal(listing.scope, "project");
  assert.equal(listing.canvases.length, 1);
  assert.equal(listing.canvases[0].open, true);
  assert.deepEqual(listing.canvases[0].sessions, [{ harness: "bb", id: "thr_1", ts: 5 }]);
  assert.equal(parseListing("{}").scope, "session");
  assert.throws(() => parseListing("[]"));
});

test("search needs every word somewhere in name, folder, host or sessions", () => {
  const c = canvas({ sessions: [{ harness: "codex", id: "x1", ts: 1 }] });
  assert.ok(matches(c, ""));
  assert.ok(matches(c, "design documents"));
  assert.ok(matches(c, "CODEX"));
  assert.ok(!matches(c, "design kb"));
});

test("thread chips: bb sessions, newest first, once each; other harnesses counted", () => {
  const c = canvas({
    sessions: [
      { harness: "bb", id: "thr_old", ts: 1 },
      { harness: "bb", id: "thr_new", ts: 9 },
      { harness: "bb", id: "thr_old", ts: 5 },
      { harness: "claude-code", id: "c", ts: 2 },
      { harness: "codex", id: "x", ts: 3 },
      { harness: "codex", id: "y", ts: 4 },
    ],
  });
  assert.deepEqual(threadIds(c), ["thr_new", "thr_old"]);
  assert.deepEqual(otherHarnesses(c), ["claude-code", "codex · 2"]);
});

test("relative times", () => {
  const now = Date.UTC(2026, 9, 23, 12);
  assert.equal(ago(now - 10_000, now), "just now");
  assert.equal(ago(now - 5 * 60_000, now), "5m ago");
  assert.equal(ago(now - 3 * 3_600_000, now), "3h ago");
  assert.equal(ago(now - 2 * 86_400_000, now), "2d ago");
  assert.equal(ago(now - 14 * 86_400_000, now), "2w ago");
  assert.equal(ago(Date.UTC(2026, 0, 2), now), "2026-01-02");
  assert.equal(timeLabel(canvas({ editedAt: now - 3_600_000, linkedAt: now }), now), "edited 1h ago");
  assert.equal(timeLabel(canvas({ editedAt: null, linkedAt: now }), now), "linked just now");
});

test("open on another machine is exit 3 with 'on <host>'", () => {
  assert.equal(elsewhereHost(3, "on shared-server\n"), "shared-server");
  assert.equal(elsewhereHost(1, "on x"), null);
  assert.equal(elsewhereHost(3, "weird"), null);
});
