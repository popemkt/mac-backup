import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWithKb } from "../src/layers.ts";
import { openKb } from "../src/session.ts";
import {
  assetUploadEffect,
  mediaKindFromExt,
  resolveAssetFile,
  textHasAssetRef,
} from "@kb/operations";
import { invoke } from "../src/invoke.ts";
import { resetRegistryCache } from "../src/registry.ts";

describe("resolveAssetFile traversal guard", () => {
  const root = "/tmp/kb-asset-root-fake";

  test("accepts plain assets/<name>", () => {
    const abs = resolveAssetFile(root, "/assets/01ABC.png");
    expect(abs).toBe(join(root, ".kb", "assets", "01ABC.png"));
    expect(resolveAssetFile(root, "assets/nested/x.webp")).toBe(
      join(root, ".kb", "assets", "nested", "x.webp"),
    );
  });

  test("rejects .. and absolute escapes", () => {
    expect(resolveAssetFile(root, "/assets/../nodes.jsonl")).toBeNull();
    expect(resolveAssetFile(root, "/assets/foo/../../etc/passwd")).toBeNull();
    expect(resolveAssetFile(root, "/assets/..\\secrets")).toBeNull();
    expect(resolveAssetFile(root, "/assets/..%2fnodes.jsonl")).toBeNull();
    expect(resolveAssetFile(root, "/assets/%2e%2e/nodes.jsonl")).toBeNull();
    expect(resolveAssetFile(root, "/assets//etc/passwd")).toBe(
      // empty segments filtered; still under assets
      join(root, ".kb", "assets", "etc", "passwd"),
    );
    expect(resolveAssetFile(root, "/api/graph")).toBeNull();
    expect(resolveAssetFile(root, "/assets")).toBeNull();
    expect(resolveAssetFile(root, "/assets/")).toBeNull();
    expect(resolveAssetFile(root, "/assets/\0x")).toBeNull();
  });
});

describe("asset.upload action", () => {
  let root: string;

  test("writes .kb/assets/<ulid>.<ext> and returns path", async () => {
    root = await mkdtemp(join(tmpdir(), "kb-asset-up-"));
    await mkdir(join(root, ".kb"), { recursive: true });
    resetRegistryCache();
    const ctx = await openKb(root);

    const bytes = Buffer.from("hello-png").toString("base64");
    const receipt = await invoke(ctx, {
      id: "asset.upload",
      input: { bytes, filename: "shot.PNG" },
    });
    expect(receipt.status).toBe("succeeded");
    if (receipt.status !== "succeeded") return;
    const out = receipt.output as {
      path: string;
      id: string;
      ext: string;
      bytes: number;
    };
    expect(out.ext).toBe("png");
    expect(out.path).toBe(`assets/${out.id}.png`);
    expect(out.bytes).toBe(9);
    const onDisk = await readFile(join(root, ".kb", "assets", `${out.id}.png`));
    expect(onDisk.toString()).toBe("hello-png");

    // No binary leaked into nodes.jsonl
    const jsonl = await readFile(join(root, ".kb", "nodes.jsonl"), "utf8");
    expect(jsonl).not.toContain("hello-png");
    expect(jsonl).not.toContain(bytes);

    await rm(root, { recursive: true, force: true });
  });

  test("rejects unsafe extensions", async () => {
    root = await mkdtemp(join(tmpdir(), "kb-asset-bad-"));
    await mkdir(join(root, ".kb"), { recursive: true });
    resetRegistryCache();
    const ctx = await openKb(root);
    const receipt = await invoke(ctx, {
      id: "asset.upload",
      input: {
        bytes: Buffer.from("x").toString("base64"),
        ext: "../x",
      },
    });
    expect(receipt.status).toBe("failed");

    // Non-media extensions are refused even when syntactically safe:
    // html/js served same-origin could carry scripts.
    for (const ext of ["html", "js", "sh", "bin"]) {
      const r = await invoke(ctx, {
        id: "asset.upload",
        input: { bytes: Buffer.from("x").toString("base64"), ext },
      });
      expect(r.status).toBe("failed");
    }
    await rm(root, { recursive: true, force: true });
  });

  test("mediaKindFromExt + textHasAssetRef helpers", () => {
    expect(mediaKindFromExt("png")).toBe("image");
    expect(mediaKindFromExt(".mp4")).toBe("video");
    expect(mediaKindFromExt("mp3")).toBe("audio");
    expect(mediaKindFromExt("exe")).toBeNull();
    expect(textHasAssetRef("see ![x](assets/a.png)")).toBe(true);
    expect(textHasAssetRef("[x](assets/a.png)")).toBe(false);
  });

  test("assetUpload handler returns same shape", async () => {
    root = await mkdtemp(join(tmpdir(), "kb-asset-h-"));
    await mkdir(join(root, ".kb"), { recursive: true });
    const ctx = await openKb(root);
    const out = await runWithKb(
      ctx,
      assetUploadEffect({
        bytes: Buffer.from([1, 2, 3]).toString("base64"),
        encoding: "base64",
        filename: "clip.webm",
      }),
    );
    expect(out.path).toMatch(/^assets\/[0-9A-HJKMNP-TV-Z]{26}\.webm$/i);
    expect(out.bytes).toBe(3);
    await rm(root, { recursive: true, force: true });
  });
});
