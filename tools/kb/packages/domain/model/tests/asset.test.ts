/**
 * kb's own media, said once: the kind of media by extension, whether a
 * reference names one of kb's assets, and whether text embeds one.
 */
import { describe, expect, test } from "bun:test";
import { isAssetPath, mediaKindFromExt, mediaKindFromHref, textHasAssetRef } from "../src/index.ts";

describe("kb's media", () => {
  test("an extension names its kind, with or without its dot", () => {
    expect(["png", ".mp4", "mp3", "exe"].map(mediaKindFromExt)).toEqual([
      "image",
      "video",
      "audio",
      null,
    ]);
    expect(
      ["assets/a.PNG", "https://x.test/v.webm?t=1", "notes.txt"].map(mediaKindFromHref),
    ).toEqual(["image", "video", null]);
  });

  test("only `assets/…` is one of kb's assets, and only `![…](assets/…)` embeds one", () => {
    expect(
      ["assets/01A.png", " assets/x", "/assets/x", "https://x/a.png", "assets/"].map(isAssetPath),
    ).toEqual([true, true, false, false, false]);
    expect(textHasAssetRef("see ![x](assets/a.png)")).toBe(true);
    expect(textHasAssetRef("[x](assets/a.png)")).toBe(false);
  });
});
