/**
 * The page's camera is its canvas view node's (DESIGN.md → Canvas documents
 * → Camera): a camera set shows at once, and is written once gestures pause
 * onto the view node the page shows the canvas through, only the fields it
 * changes; a canvas that names no canvas view gets one proposed; and the
 * document is never written.
 */
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  CANVAS_IDS,
  CanvasView,
  canvasCameraProps,
  type CanvasCamera,
  type CanvasPose,
} from "@kb/canvas";
import { SYSTEM_IDS, syncUiPlugins, type OutlineNode, type PropValue } from "@kb/ui-sdk";
import {
  installDomGlobals,
  testBrowserHost,
  testHostPlugin,
  type InstalledDom,
} from "@kb/ui-test-kit";
import { useCanvasCamera } from "./use-canvas-camera";

const POSE: CanvasPose = { x: 1, y: 2, z: 3, zoom: 1, yaw: 0.2, pitch: 0.4 };

function outline(id: string, props: OutlineNode["props"] = {}): OutlineNode {
  return {
    id,
    text: id,
    parentId: null,
    children: [],
    collapsed: false,
    props,
    tags: [],
    createdAt: "",
    updatedAt: "",
  };
}

const ref = (v: string): PropValue => ({ t: "ref", v });
const viewNode = (id: string, camera?: CanvasCamera) =>
  outline(id, { [SYSTEM_IDS.viewField]: [ref(CanvasView.option)], ...canvasCameraProps(camera) });
const canvasNaming = (...views: string[]) =>
  outline("canvas", { [SYSTEM_IDS.viewsField]: views.map(ref) });

describe("useCanvasCamera", () => {
  let dom: InstalledDom;
  let root: Root;
  let current: ReturnType<typeof useCanvasCamera> | undefined;
  const replaceField = vi.fn<(id: string, field: string, values: PropValue[]) => Promise<void>>();
  const proposeView = vi.fn().mockResolvedValue({ id: "v.proposed" });

  beforeAll(() => {
    dom = installDomGlobals("https://kb.test/");
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterAll(() => dom.restore());
  beforeEach(() => {
    vi.useFakeTimers();
    replaceField.mockReset().mockResolvedValue();
    proposeView.mockClear();
    const base = testBrowserHost();
    syncUiPlugins([
      testHostPlugin(testBrowserHost({ proposeView, writes: { ...base.writes, replaceField } })),
    ]);
    root = createRoot(document.body.appendChild(document.createElement("div")));
  });
  afterEach(() => {
    act(() => root.unmount());
    syncUiPlugins([]);
    vi.useRealTimers();
  });

  function show(nodes: readonly OutlineNode[], route?: string) {
    function Harness() {
      const seen = useCanvasCamera({
        canvasId: "canvas",
        viewNode: route,
        nodes: new Map(nodes.map((node) => [node.id, node])),
      });
      useLayoutEffect(() => {
        current = seen;
      });
      return null;
    }
    act(() => root.render(<Harness />));
  }

  test("looks through the camera of the canvas's own view node", () => {
    show([canvasNaming("v.own"), viewNode("v.own", { projection: "3d", pose: POSE })]);
    expect(current?.camera).toEqual({ projection: "3d", pose: POSE });
  });

  test("looks through the view node its route names, before the canvas's own", () => {
    show(
      [canvasNaming("v.own"), viewNode("v.own", { projection: "3d" }), viewNode("v.route")],
      "v.route",
    );
    expect(current?.camera).toBeUndefined();
  });

  test("shows a camera set at once, and writes only what changed once gestures pause", async () => {
    show([canvasNaming("v.own"), viewNode("v.own", { projection: "3d", pose: POSE })]);
    act(() => current?.setCamera({ projection: "2d", pose: POSE }));
    expect(current?.camera).toEqual({ projection: "2d", pose: POSE });
    expect(replaceField).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(replaceField.mock.calls).toEqual([
      ["v.own", CANVAS_IDS.canvasProjectionField, [ref(CANVAS_IDS.canvasProjection2d)]],
    ]);
  });

  test("writes the last camera of a burst once", async () => {
    show([canvasNaming("v.own"), viewNode("v.own", { projection: "3d", pose: POSE })]);
    act(() => current?.setCamera({ projection: "3d", pose: { ...POSE, x: 5 } }));
    act(() => current?.setCamera({ projection: "3d", pose: { ...POSE, x: 9 } }));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(replaceField).toHaveBeenCalledTimes(1);
    const [, field, values] = replaceField.mock.calls[0] ?? [];
    expect(field).toBe(CANVAS_IDS.canvasPoseField);
    expect(values).toEqual(
      canvasCameraProps({ projection: "3d", pose: { ...POSE, x: 9 } })[CANVAS_IDS.canvasPoseField],
    );
  });

  test("proposes a view node for a canvas that names none, looking through the camera", async () => {
    show([outline("canvas")]);
    act(() => current?.setCamera({ projection: "3d" }));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(replaceField).not.toHaveBeenCalled();
    expect(proposeView).toHaveBeenCalledWith({
      view: CanvasView,
      params: { id: "canvas", projection: "3d" },
      host: "canvas",
    });
  });

  test("goes back to the view node's camera once it holds what was set", () => {
    show([canvasNaming("v.own"), viewNode("v.own", { projection: "3d" })]);
    act(() => current?.setCamera({ projection: "2d" }));
    show([canvasNaming("v.own"), viewNode("v.own", { projection: "2d" })]);
    show([canvasNaming("v.own"), viewNode("v.own", { projection: "3d" })]);
    // An agent's later write is what the page looks through.
    expect(current?.camera).toEqual({ projection: "3d" });
  });

  test("writes a pending camera when the page closes", () => {
    show([canvasNaming("v.own"), viewNode("v.own")]);
    act(() => current?.setCamera({ projection: "3d" }));
    act(() => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    expect(replaceField).toHaveBeenCalledWith("v.own", CANVAS_IDS.canvasProjectionField, [
      ref(CANVAS_IDS.canvasProjection3d),
    ]);
  });
});
