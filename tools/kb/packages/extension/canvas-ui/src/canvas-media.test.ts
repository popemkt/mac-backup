/**
 * Pictures onto the canvas (`canvas-media`): stored through the one upload,
 * placed as image items whose file is the asset's path, centred where they
 * land, in one write, selected.
 */
import { describe, expect, test } from "vitest";
import { isFileNode, type CanvasDoc } from "@kb/canvas";
import { imageFilesOf, placePictures, type PictureWrite } from "./canvas-media";
import type { CanvasSelection } from "./canvas-selection";

const frame: CanvasDoc = {
  nodes: [{ id: "f", type: "group", x: 0, y: 0, width: 800, height: 600 }],
  edges: [],
};

function recorder(stored: (name: string) => string | null) {
  const written: CanvasDoc[] = [];
  const selected: CanvasSelection[] = [];
  const uploads: string[] = [];
  const write: PictureWrite = {
    upload: async (file) => {
      uploads.push(file.name);
      return stored(file.name);
    },
    doc: () => written.at(-1) ?? frame,
    persist: (doc) => written.push(doc),
    select: (selection) => selected.push(selection),
  };
  return { write, written, selected, uploads };
}

const png = (name: string) => new File(["png"], name, { type: "image/png" });

describe("pictures onto the canvas", () => {
  test("only image files are pictures", () => {
    const text = new File(["x"], "notes.txt", { type: "text/plain" });
    expect(imageFilesOf([text, png("a.png")]).map((file) => file.name)).toEqual(["a.png"]);
  });

  test("each picture is uploaded and placed as an image of its asset, in one write, selected", async () => {
    const { write, written, selected, uploads } = recorder((name) => `assets/${name}`);
    const items = await placePictures([png("a.png"), png("b.png")], { x: 200, y: 150 }, write);
    expect(uploads).toEqual(["a.png", "b.png"]);
    expect(written).toHaveLength(1);
    const images = written[0]?.nodes.filter(isFileNode) ?? [];
    expect(images.map((image) => image.file)).toEqual(["assets/a.png", "assets/b.png"]);
    // Centred where it landed (a size this browser cannot read is the preset's), the next staggered.
    expect(images[0]).toMatchObject({ x: 40, y: 30, width: 320, height: 240, parent: "f" });
    expect(images[1]).toMatchObject({ x: 64, y: 54 });
    expect(selected).toEqual([
      { nodeIds: new Set(items.map((item) => item.id)), edgeIds: new Set() },
    ]);
  });

  test("a file the upload could not store is left out, and nothing is written for none", async () => {
    const { write, written, selected } = recorder(() => null);
    expect(await placePictures([png("a.png")], { x: 0, y: 0 }, write)).toEqual([]);
    expect(written).toEqual([]);
    expect(selected).toEqual([]);
  });
});
