/**
 * The canvas's ways in for pictures (`use-canvas-pictures`): a drop places
 * its pictures where it lands and never lets the browser open a file in
 * place of the page; the image tool's chooser places what is picked.
 */
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { CanvasDoc } from "@kb/canvas";
import { installDomGlobals, type InstalledDom } from "@kb/ui-test-kit";
import { useCanvasPictures } from "./use-canvas-pictures";

const png = (name: string) => new File(["png"], name, { type: "image/png" });
const pdf = (name: string) => new File(["%PDF"], name, { type: "application/pdf" });

/** A drag's data as the browser hands it over: its types, its items' kinds and types, its files. */
function transfer(files: File[]) {
  return {
    types: files.length > 0 ? ["Files"] : ["text/plain"],
    items: files.map((file) => ({ kind: "file", type: file.type })),
    files,
    dropEffect: "",
  };
}

function dragEvent(files: File[]) {
  const preventDefault = vi.fn();
  const dataTransfer = transfer(files);
  const event = { dataTransfer, clientX: 300, clientY: 200, preventDefault };
  return { event: event as unknown as React.DragEvent, preventDefault, dataTransfer };
}

/** Settle the uploads and the one write after them. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function pictures() {
  const uploads: string[] = [];
  const written: CanvasDoc[] = [];
  const doc: CanvasDoc = { nodes: [], edges: [] };
  const top = {
    x: 0,
    y: 0,
    z: 0,
    zoom: 1,
    yaw: 0,
    pitch: 0,
    fov: 0,
  };
  const seen: { hook?: ReturnType<typeof useCanvasPictures> } = {};
  function Probe() {
    const hook = useCanvasPictures({
      docRef: { current: doc },
      schedulePersist: (next) => written.push(next),
      setSelection: () => {},
      upload: async (file) => {
        uploads.push(file.name);
        return `assets/${file.name}`;
      },
      camera: () => ({ view: top, size: { width: 800, height: 600 } }),
      pointerAt: () => ({ x: 400, y: 300 }),
      placementPoint: () => ({ x: 10, y: 20 }),
      stage: { current: { getBoundingClientRect: () => ({ left: 100, top: 50 }) } as HTMLElement },
    });
    useEffect(() => {
      seen.hook = hook;
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe)));
  const { hook } = seen;
  act(() => root.unmount());
  if (hook === undefined) throw new Error("the hook never ran");
  return { hook, uploads, written };
}

describe("pictures onto the canvas, by hand", () => {
  let dom: InstalledDom;
  beforeAll(() => {
    dom = installDomGlobals("https://kb.test/");
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterAll(() => dom.restore());

  test("a drag carrying a picture may drop; one carrying other files is refused, not opened", () => {
    const { hook } = pictures();
    const image = dragEvent([png("a.png")]);
    hook.onDragOver(image.event);
    expect(image.preventDefault).toHaveBeenCalled();
    expect(image.dataTransfer.dropEffect).toBe("copy");
    const other = dragEvent([pdf("b.pdf")]);
    hook.onDragOver(other.event);
    expect(other.preventDefault).toHaveBeenCalled();
    expect(other.dataTransfer.dropEffect).toBe("none");
    // Not a drag of files at all: the page's own.
    const text = dragEvent([]);
    hook.onDragOver(text.event);
    expect(text.preventDefault).not.toHaveBeenCalled();
  });

  test("a dropped picture lands where it was let go", async () => {
    const { hook, uploads, written } = pictures();
    const drop = dragEvent([png("a.png")]);
    hook.onDrop(drop.event);
    expect(drop.preventDefault).toHaveBeenCalled();
    await settle();
    expect(uploads).toEqual(["a.png"]);
    // Viewport (200, 150) through the top view at zoom 1 over a 800 × 600 viewport centred on 0.
    expect(written[0]?.nodes[0]).toMatchObject({ type: "file", file: "assets/a.png" });
    const image = written[0]?.nodes[0];
    expect((image?.x ?? 0) + (image?.width ?? 0) / 2).toBeCloseTo(-200, 6);
    expect((image?.y ?? 0) + (image?.height ?? 0) / 2).toBeCloseTo(-150, 6);
  });

  test("a dropped file that is no picture is kept from the browser, and nothing is placed", async () => {
    const { hook, uploads, written } = pictures();
    const drop = dragEvent([pdf("b.pdf")]);
    hook.onDrop(drop.event);
    expect(drop.preventDefault).toHaveBeenCalled();
    await settle();
    expect(uploads).toEqual([]);
    expect(written).toEqual([]);
  });

  test("of a mixed drop, only the pictures are placed", async () => {
    const { hook, uploads, written } = pictures();
    const drop = dragEvent([pdf("b.pdf"), png("a.png")]);
    hook.onDrop(drop.event);
    expect(drop.preventDefault).toHaveBeenCalled();
    await settle();
    expect(uploads).toEqual(["a.png"]);
    expect(written[0]?.nodes).toHaveLength(1);
  });

  test("the image tool's chooser asks for pictures and places those picked", async () => {
    const { hook, uploads, written } = pictures();
    const made = vi.spyOn(document, "createElement");
    const click = vi.spyOn(window.HTMLInputElement.prototype, "click").mockImplementation(() => {});
    hook.choose();
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
    const input = made.mock.results.at(-1)?.value as HTMLInputElement | undefined;
    made.mockRestore();
    expect(input?.accept).toBe("image/*");
    expect(input?.multiple).toBe(true);
    Object.defineProperty(input, "files", { value: [png("c.png"), pdf("d.pdf")] });
    input?.dispatchEvent(new window.Event("change"));
    await settle();
    expect(uploads).toEqual(["c.png"]);
    expect(written[0]?.nodes[0]).toMatchObject({ file: "assets/c.png" });
  });
});
