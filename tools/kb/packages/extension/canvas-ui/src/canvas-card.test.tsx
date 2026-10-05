/**
 * A card's node text is edited on a canvas: the node a card shows is one
 * projected instance per projection (`canvasInstanceKey`), which the card
 * asks the page to activate — in 2D where the card lies, in 3D in the face
 * editor laid on it — and only the projection showing edits it. The card
 * binds its text host through the page's `BrowserHost`, never the shell's
 * stores, so these tests hold it to that port (a test host); that the
 * shell's activation accepts a canvas instance is the outline's own test
 * (`@kb/ui`'s `lib/instance-key.test.ts`).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { CanvasKbNode } from "@kb/canvas";
import {
  type BrowserHost,
  canvasInstanceKey,
  type OutlineNode,
  syncUiPlugins,
  TIMING_FALLBACK,
} from "@kb/ui-sdk";
import {
  installDomGlobals,
  type InstalledDom,
  testBrowserHost,
  testHostPlugin,
  type TestBrowserHost,
} from "@kb/ui-test-kit";
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
/** The node the card shows. */
const shown: OutlineNode = {
  id: "n.root-a",
  text: "Root A",
  parentId: null,
  children: [],
  collapsed: false,
  props: {},
  tags: [],
  createdAt: "2026-09-05T00:00:00.000Z",
  updatedAt: "2026-09-05T00:00:00.000Z",
};
const noop = () => {};

function cardIn2d() {
  return (
    <KbNodeCard
      card={card}
      projection="2d"
      box={{ left: 0, top: 0, width: 280, height: 72 }}
      editing
      onEdit={noop}
      selected
      onSelect={noop}
      onMoveStart={noop}
      onResizeStart={noop}
      onRotateStart={noop}
      onPortDown={noop}
    />
  );
}

describe("a card's node text on a canvas", () => {
  let dom: InstalledDom;
  let root: Root;
  let host: TestBrowserHost;

  beforeAll(() => {
    dom = installDomGlobals("https://kb.test/");
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterAll(() => dom.restore());
  beforeEach(() => {
    host = testBrowserHost();
    host.setNodes([shown]);
    syncUiPlugins([testHostPlugin(host)]);
    root = createRoot(document.body.appendChild(document.createElement("div")));
  });
  afterEach(() => {
    act(() => root.unmount());
    // The kernel keeps a plugin it already holds by name, so each test's host is loaded afresh.
    syncUiPlugins([]);
  });

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
    expect(host.active()).toEqual({
      nodeId: "n.root-a",
      instanceKey: canvasInstanceKey("2d", "card", "n.root-a"),
    });
    expect(edits).toEqual([true]);
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
    expect(host.active()?.instanceKey).toBe(canvasInstanceKey("3d", "card", "n.root-a"));
    expect(edits).toEqual(["card:open"]);
  });

  test("the card's caret hand-off and text-host registry go through BrowserHost", () => {
    const calls: string[] = [];
    const spy: BrowserHost = {
      ...host,
      registerTextHost: (key) => {
        calls.push(`register ${key}`);
        host.registerTextHost(key);
      },
      unregisterTextHost: (key) => {
        calls.push(`unregister ${key}`);
        host.unregisterTextHost(key);
      },
      consumeCaret: (key) => {
        calls.push(`consume ${key}`);
        return host.consumeCaret(key);
      },
    };
    syncUiPlugins([]);
    syncUiPlugins([testHostPlugin(spy)]);
    act(() => root.render(cardIn2d()));
    const key = canvasInstanceKey("2d", "card", "n.root-a");
    expect(host.active()?.instanceKey).toBe(key);
    expect(calls).toEqual([`register ${key}`, `consume ${key}`]);
    act(() => root.render(null));
    expect(calls).toContain(`unregister ${key}`);
  });
});
