/**
 * The pictures 3D image faces are painted with (`canvas-face-pictures`): one
 * load per source, its owner told when it settles either way, and every
 * source no face shows let go — its load's handlers gone and its picture
 * dropped.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { FacePictures } from "./canvas-face-pictures";

/** A stand-in for the browser's image: it loads, or fails, when the test says. */
class FakeImage extends EventTarget {
  static made: FakeImage[] = [];
  decoding = "";
  src = "";
  constructor() {
    super();
    FakeImage.made.push(this);
  }
  removeAttribute(name: string): void {
    if (name === "src") this.src = "";
  }
  settle(how: "load" | "error"): void {
    this.dispatchEvent(new Event(how));
  }
}

const g = globalThis as Record<string, unknown>;
let saved: unknown;

beforeEach(() => {
  saved = g.Image;
  g.Image = FakeImage;
  FakeImage.made = [];
});

afterEach(() => {
  g.Image = saved;
});

describe("face pictures", () => {
  test("a source loads once, and its owner hears when it is ready or missing", () => {
    const settled: string[] = [];
    const pictures = new FacePictures((src) => settled.push(src));
    expect(pictures.get("/assets/a.png")).toEqual({ state: "loading" });
    expect(pictures.get("/assets/a.png")).toEqual({ state: "loading" });
    expect(FakeImage.made).toHaveLength(1);
    FakeImage.made[0]?.settle("load");
    expect(settled).toEqual(["/assets/a.png"]);
    expect(pictures.get("/assets/a.png").state).toBe("ready");
    pictures.get("/assets/gone.png");
    FakeImage.made[1]?.settle("error");
    expect(pictures.get("/assets/gone.png")).toEqual({ state: "missing" });
    pictures.dispose();
  });

  test("a source no face shows is let go: its load is no longer heard, and it is asked for afresh", () => {
    const settled: string[] = [];
    const pictures = new FacePictures((src) => settled.push(src));
    pictures.get("/assets/a.png");
    pictures.get("/assets/b.png");
    pictures.keep(new Set(["/assets/b.png"]));
    const [a, b] = FakeImage.made;
    expect(a?.src).toBe("");
    expect(b?.src).toBe("/assets/b.png");
    a?.settle("load");
    pictures.dispose();
    b?.settle("load");
    expect(settled).toEqual([]);
    pictures.get("/assets/a.png");
    expect(FakeImage.made).toHaveLength(3);
  });
});
