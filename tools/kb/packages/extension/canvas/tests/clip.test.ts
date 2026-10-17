/**
 * A frame clips what it holds (`clip.ts`): an item is drawn and hit only
 * where every frame above it reaches, seen from above; the SVG export cuts
 * it there too.
 */
import { describe, expect, test } from "bun:test";
import {
  canvasSvg,
  inClip,
  itemClips,
  type CanvasGroupNode,
  type CanvasNode,
} from "../src/index.ts";

const frame = (
  id: string,
  x: number,
  y: number,
  more: Partial<CanvasGroupNode> = {},
): CanvasGroupNode => ({
  id,
  type: "group",
  label: id,
  x,
  y,
  width: 200,
  height: 100,
  ...more,
});
const note = (id: string, parent?: string): CanvasNode => ({
  id,
  type: "text",
  text: id,
  x: 150,
  y: 40,
  width: 120,
  height: 40,
  ...(parent === undefined ? {} : { parent }),
});

describe("a frame clips what it holds", () => {
  test("a member is cut to its frame; an item no frame holds is whole", () => {
    const clips = itemClips([frame("f", 0, 0), note("in", "f"), note("free")]);
    expect([...clips.keys()]).toEqual(["in"]);
    const clip = clips.get("in") ?? [];
    expect(inClip(clip, 190, 50)).toBe(true);
    expect(inClip(clip, 210, 50)).toBe(false);
    expect(inClip(clip, 200, 100)).toBe(true);
  });

  test("a member of nested frames is cut to where both reach", () => {
    const clips = itemClips([
      frame("outer", 0, 0),
      frame("inner", 100, 50, { parent: "outer" }),
      note("deep", "inner"),
    ]);
    const clip = clips.get("deep") ?? [];
    expect(inClip(clip, 150, 75)).toBe(true);
    expect(inClip(clip, 250, 75)).toBe(false);
    expect(inClip(clip, 150, 120)).toBe(false);
    expect(inClip(clip, 50, 75)).toBe(false);
  });

  test("a turned frame cuts along its turned sides", () => {
    const clips = itemClips([frame("f", 0, 0, { rotation: { z: 45 } }), note("in", "f")]);
    const clip = clips.get("in") ?? [];
    // Its corner swings out of its box; the box's corner is off it.
    expect(inClip(clip, 100, 50)).toBe(true);
    expect(inClip(clip, 2, 2)).toBe(false);
    expect(inClip(clip, 100, -15)).toBe(true);
  });

  test("the SVG export draws a member inside a clip of its frame's reach", () => {
    const svg = canvasSvg(
      { nodes: [frame("f", 0, 0), note("in", "f"), note("free")], edges: [] },
      { textOf: () => undefined, bound: () => true },
    );
    expect(svg).toContain('<clipPath id="kb-clip-0"><polygon points="');
    expect(svg).toMatch(/<g data-item-clip="" clip-path="url\(#kb-clip-0\)"><g data-card-id="in"/);
    expect(svg).not.toMatch(/clip-path="[^"]*"><g data-card-id="free"/);
  });
});
