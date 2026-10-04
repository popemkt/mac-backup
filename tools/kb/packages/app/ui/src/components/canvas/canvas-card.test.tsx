/**
 * A card's node text is edited on a canvas: the node a card shows is one
 * projected instance per projection (`canvasInstanceKey`), which the outline
 * activates as it does a query's rows — in 2D where the card lies, in 3D in
 * the face editor laid on it — and only the projection showing edits it.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { CanvasKbNode } from "@kb/canvas";
import { fixtureGraph } from "@/api/fixture-graph";
import { browserHostUiPlugin } from "@/browser-host";
import { canvasInstanceKey } from "@/lib/instance-key";
import { syncUiPlugins } from "@/lib/plugins";
import { TIMING_FALLBACK } from "@/lib/timing";
import { useOutlineStore } from "@/stores/outline.store";
import { useUiStore } from "@/stores/ui.store";
import { installDomGlobals, type InstalledDom } from "@/test-support/dom-globals";
import { resetOutlineStore } from "@/test-support/outline-store";
import { KbNodeCard } from "./canvas-card";
import { CanvasCameraRig } from "./canvas-camera-rig";
import { CanvasFaceEditor } from "./canvas-face-editor";

const card: CanvasKbNode = {
  id: "card",
  type: "kb-node",
  nodeId: "n.root-a",
  x: 0,
  y: 0,
  width: 280,
  height: 72,
};
const noop = () => {};
/** Every toast the page has raised. */
const toasts = () => useUiStore.getState().toasts.map((t) => t.text);

describe("a card's node text on a canvas", () => {
  let dom: InstalledDom;
  let root: Root;

  beforeAll(() => {
    dom = installDomGlobals("https://kb.test/");
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    syncUiPlugins([browserHostUiPlugin]);
  });
  afterAll(() => {
    syncUiPlugins([]);
    dom.restore();
  });
  beforeEach(() => {
    resetOutlineStore();
    useOutlineStore.getState().hydrateFromWire(fixtureGraph.nodes, fixtureGraph.rev, "fixtures");
    root = createRoot(document.body.appendChild(document.createElement("div")));
  });
  afterEach(() => act(() => root.unmount()));

  test("in 2D, opening the card's editor activates its node where the card lies", () => {
    const edits: boolean[] = [];
    act(() =>
      root.render(
        <KbNodeCard
          card={card}
          projection="2d"
          box={{ left: 0, top: 0, width: 280, height: 72 }}
          editing
          onEdit={(on) => edits.push(on)}
          selected
          onSelect={noop}
          onMoveStart={noop}
          onResizeStart={noop}
          onRotateStart={noop}
          onPortDown={noop}
        />,
      ),
    );
    const { activeNodeId, activeInstanceKey } = useOutlineStore.getState();
    expect(activeNodeId).toBe("n.root-a");
    expect(activeInstanceKey).toBe(canvasInstanceKey("2d", "card", "n.root-a"));
    expect(edits).toEqual([true]);
    expect(toasts()).not.toContain("That node is not visible in this outline");
  });

  test("in 3D, the face editor activates the node in the 3D instance alone", () => {
    const rig = new CanvasCameraRig(
      { x: 140, y: 36, z: 0, zoom: 1, yaw: 0.3, pitch: 0.6, fov: 34 },
      TIMING_FALLBACK,
      true,
    );
    const edits: string[] = [];
    act(() =>
      root.render(
        <CanvasFaceEditor
          item={card}
          rig={rig}
          size={() => ({ width: 1000, height: 700 })}
          onEdit={(id, on) => edits.push(`${id}:${on ? "open" : "closed"}`)}
          onChange={noop}
        />,
      ),
    );
    expect(useOutlineStore.getState().activeInstanceKey).toBe(
      canvasInstanceKey("3d", "card", "n.root-a"),
    );
    expect(edits).toEqual(["card:open"]);
    expect(toasts()).not.toContain("That node is not visible in this outline");
  });
});
