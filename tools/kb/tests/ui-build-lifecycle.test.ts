import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ensureUiBuilt,
  needsUiBuild,
  readBuildMarker,
  uiSourceFingerprint,
  writeBuildMarker,
  type UiBuildRunner,
} from "../src/surface/ui/build.ts";

/**
 * Deterministic lifecycle tests for the fresh-checkout `kb ui` auto-build.
 * Uses only temp dirs — never builds the real UI, never touches the live
 * checkout, needs no browser.
 */

let roots: string[] = [];

afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
  roots = [];
});

async function makeUi(): Promise<{ uiRoot: string; distDir: string }> {
  const uiRoot = await mkdtemp(join(import.meta.dir, "kb-uibuild-"));
  roots.push(uiRoot);
  const distDir = join(uiRoot, "dist");
  await mkdir(join(uiRoot, "src"), { recursive: true });
  await writeFile(join(uiRoot, "index.html"), "<div id=\"root\"></div>\n");
  await writeFile(join(uiRoot, "package.json"), "{}\n");
  await writeFile(join(uiRoot, "vite.config.ts"), "export default {}\n");
  await writeFile(join(uiRoot, "tsconfig.json"), "{}\n");
  await writeFile(join(uiRoot, "src", "main.ts"), "export const v = 1;\n");
  return { uiRoot, distDir };
}

describe("ui source fingerprint", () => {
  test("is stable across runs and changes when sources change", async () => {
    const { uiRoot } = await makeUi();
    const a = await uiSourceFingerprint(uiRoot);
    const b = await uiSourceFingerprint(uiRoot);
    expect(a).toBe(b);

    await writeFile(join(uiRoot, "src", "main.ts"), "export const v = 2;\n");
    const c = await uiSourceFingerprint(uiRoot);
    expect(c).not.toBe(a);
  });
});

describe("needsUiBuild decision", () => {
  test("missing index.html → missing; no marker → stale; matching marker → fresh", async () => {
    const { uiRoot, distDir } = await makeUi();
    expect(await needsUiBuild(uiRoot, distDir)).toBe("missing");

    await mkdir(distDir, { recursive: true });
    await writeFile(join(distDir, "index.html"), "<div id=\"root\"></div>\n");
    expect(await needsUiBuild(uiRoot, distDir)).toBe("stale");

    const fp = await uiSourceFingerprint(uiRoot);
    await writeBuildMarker(distDir, fp);
    expect(await needsUiBuild(uiRoot, distDir)).toBe("fresh");

    // A source change after a fresh build makes it stale again.
    await writeFile(join(uiRoot, "src", "main.ts"), "export const v = 3;\n");
    expect(await needsUiBuild(uiRoot, distDir)).toBe("stale");
  });

  test("marker round-trips through read/write", async () => {
    const { distDir } = await makeUi();
    expect(await readBuildMarker(distDir)).toBeNull();
    await writeBuildMarker(distDir, "fp-123");
    expect(await readBuildMarker(distDir)).toBe("fp-123");
  });
});

describe("ensureUiBuilt", () => {
  test("skips the build when fresh", async () => {
    const { uiRoot, distDir } = await makeUi();
    await mkdir(distDir, { recursive: true });
    await writeFile(join(distDir, "index.html"), "built");
    await writeBuildMarker(distDir, await uiSourceFingerprint(uiRoot));

    const calls: string[] = [];
    const runner: UiBuildRunner = async () => {
      calls.push("build");
    };
    const result = await ensureUiBuilt(uiRoot, distDir, runner);
    expect(result).toEqual({ built: false, state: "fresh" });
    expect(calls).toEqual([]);
  });

  test("builds when missing/stale and records the post-build marker", async () => {
    const { uiRoot, distDir } = await makeUi();
    const calls: string[] = [];
    const runner: UiBuildRunner = async (root, dist) => {
      calls.push("build");
      await mkdir(dist, { recursive: true });
      await writeFile(join(dist, "index.html"), "built");
    };

    const missing = await ensureUiBuilt(uiRoot, distDir, runner);
    expect(missing).toEqual({ built: true, state: "missing" });
    expect(calls).toEqual(["build"]);
    expect(await needsUiBuild(uiRoot, distDir)).toBe("fresh");

    // Second run is a no-op.
    const again = await ensureUiBuilt(uiRoot, distDir, runner);
    expect(again).toEqual({ built: false, state: "fresh" });
    expect(calls).toEqual(["build"]);

    // Touching a source forces a rebuild.
    await writeFile(join(uiRoot, "src", "main.ts"), "export const v = 9;\n");
    const stale = await ensureUiBuilt(uiRoot, distDir, runner);
    expect(stale).toEqual({ built: true, state: "stale" });
    expect(calls).toEqual(["build", "build"]);
  });
});
