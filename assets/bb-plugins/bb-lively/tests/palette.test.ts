// The palette switch (adapter/palette.ts) and the art image route (adapter/art.ts).
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { artPath, artResponse } from "../adapter/art.ts";
import { paletteStep, themeIdOf } from "../adapter/palette.ts";

const step = (before: string | null, after: string | null, active: string, saved?: string) =>
  paletteStep({ pluginId: "bb-lively", before, after, active, saved });
const ZZZ = themeIdOf("bb-lively", "lively-zzz");
const LIVELY = themeIdOf("bb-lively", "lively");

test("palette: the first switch remembers the person's theme", () => {
  assert.deepEqual(step(null, "lively-zzz", "nord"), { set: ZZZ, saved: "nord" });
});

test("palette: preset to preset switches again and keeps the remembered theme", () => {
  assert.deepEqual(step("lively-zzz", "lively", ZZZ, "nord"), { set: LIVELY });
});

test("palette: a preset without one puts the remembered theme back and forgets it", () => {
  assert.deepEqual(step("lively-zzz", null, ZZZ, "nord"), { set: "nord", saved: null });
});

test("palette: a theme the person picked since is theirs: never overridden on the way back, remembered on the way on", () => {
  assert.deepEqual(step("lively-zzz", null, "dracula", "nord"), { saved: null });
  assert.deepEqual(step("lively-zzz", "lively", "dracula", "nord"), { set: LIVELY, saved: "dracula" });
});

test("palette: no change does nothing; already active sets nothing", () => {
  assert.deepEqual(step("lively", "lively", "nord", "x"), {});
  assert.deepEqual(step(null, "lively", LIVELY), { saved: LIVELY });
  assert.deepEqual(step(null, null, "nord"), {});
});

test("art route: only an image file at the set path; anything else is a 404", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lively-art-"));
  const png = join(dir, "art.png");
  writeFileSync(png, new Uint8Array([137, 80, 78, 71]));
  writeFileSync(join(dir, "notes.txt"), "secret");
  const ok = await artResponse(png);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/png");
  assert.equal(ok.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await ok.arrayBuffer()).byteLength, 4);
  const refused = ["", "https://example.com/a.png", join(dir, "notes.txt"), join(dir, "missing.png"), dir];
  const statuses = await Promise.all(refused.map(async (value) => (await artResponse(value)).status));
  assert.deepEqual(statuses, refused.map(() => 404));
  assert.equal(artPath("~/a.png", "/home/me"), "/home/me/a.png");
  assert.equal(artPath("relative.png"), undefined);
});
