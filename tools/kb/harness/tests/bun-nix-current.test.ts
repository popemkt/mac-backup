import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WORKSPACE_ROOT, rootManifest } from "../src/workspace.ts";

/**
 * `bun.nix` is `bun.lock` restated for Nix (`pkgs/kb` builds from it), so it
 * is generated, never edited: kb's `postinstall` rewrites it on every install.
 * These checks are the gate behind that — a lockfile committed without its
 * regenerated `bun.nix` would build yesterday's dependencies.
 *
 * Two tools meet at that file: the catalog's `bun2nix` CLI writes it and the
 * flake's `bun2nix` input reads it, so their versions are one pin, compared
 * here rather than trusted to move together.
 */
const REPO_ROOT = join(WORKSPACE_ROOT, "..", "..");

describe("bun-nix-current", () => {
  test("bun.nix is exactly what bun2nix makes of bun.lock", () => {
    const generated = Bun.spawnSync(
      [join(WORKSPACE_ROOT, "node_modules/.bin/bun2nix"), "-l", "bun.lock"],
      {
        cwd: WORKSPACE_ROOT,
      },
    );
    expect(generated.exitCode, generated.stderr.toString()).toBe(0);
    expect(
      generated.stdout.toString() === readFileSync(join(WORKSPACE_ROOT, "bun.nix"), "utf8"),
      "tools/kb/bun.nix is stale: run `bun install --cwd tools/kb` and commit bun.nix",
    ).toBe(true);
  });

  test("the bun2nix CLI and the flake input are the same release", () => {
    const cli = rootManifest().workspaces?.catalog?.["bun2nix"];
    const flake = /github:nix-community\/bun2nix\/([^"]+)"/.exec(
      readFileSync(join(REPO_ROOT, "flake.nix"), "utf8"),
    )?.[1];
    expect(flake, "flake.nix pins bun2nix by release tag").toBeDefined();
    expect(cli).toBe(flake);
  });
});
