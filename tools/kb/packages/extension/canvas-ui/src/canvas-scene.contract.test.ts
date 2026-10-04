/**
 * The scene contract (`sceneContract`, `@kb/ui-test-kit`) over the canvas's
 * one scene, the 3D projection: mounted with a raised card, an edge and a
 * selection, so the gizmo is drawn (and given back) too, and with a camera
 * handover in flight, so the scene must still stop, hide and hold still on
 * cue. `@kb/ui` runs the same suite over the lab's studies and the 3D graph.
 */
import { vi } from "vitest";
import type { ScenePalette } from "@kb/scene";
import { TIMING_FALLBACK } from "@kb/ui-sdk";
import { sceneContract } from "@kb/ui-test-kit";
import type * as ThreeWebGpu from "three/webgpu";

vi.mock("three/webgpu", async (importOriginal) => ({
  ...(await importOriginal<typeof ThreeWebGpu>()),
  ...(await import("@kb/ui-test-kit")).FAKE_WEBGPU,
}));

const palette: ScenePalette = {
  ground: "rgb(20, 20, 30)",
  edge: "rgb(10, 10, 16)",
  hue: "rgb(90, 80, 160)",
  ink: "rgb(230, 230, 240)",
  accent: "rgb(210, 140, 40)",
};

sceneContract([
  [
    "3D canvas",
    async (host, reduced) => {
      const { mountCanvasScene } = await import("./canvas-scene");
      const { CanvasCameraRig } = await import("./canvas-camera-rig");
      const view = { x: 0, y: 0, z: 0, zoom: 1, yaw: -0.2, pitch: 0.5, fov: 34 };
      const rig = new CanvasCameraRig(view, TIMING_FALLBACK, reduced);
      const scene = await mountCanvasScene(host, {
        rig,
        content: {
          doc: {
            nodes: [
              { id: "a", type: "text", text: "a card", x: 0, y: 0, width: 200, height: 80 },
              {
                id: "b",
                type: "text",
                text: "raised",
                x: 260,
                y: 40,
                width: 200,
                height: 80,
                z: 90,
              },
            ],
            edges: [{ id: "e", fromNode: "a", toNode: "b", toEnd: "arrow" }],
          },
          nodes: new Map(),
          // A selection, so the gizmo stands on it and is drawn (and given back) too.
          selection: { nodeIds: new Set(["a"]), edgeIds: new Set() },
        },
        look: {
          face: "rgb(20, 20, 30)",
          ink: "rgb(230, 230, 240)",
          primary: "rgb(210, 140, 40)",
          danger: "rgb(220, 60, 60)",
          presets: {},
          font: "sans-serif",
          body: 14.5,
          ui: 13,
          label: 11,
          radius: 18,
          shapeRadius: 8,
        },
        palette,
        dark: true,
        timing: TIMING_FALLBACK,
        reducedMotion: reduced,
        gizmo: { mode: "rotate", space: "local" },
      });
      // A handover in flight: the scene must still stop, hide and hold still on cue.
      rig.flyTo({ ...view, yaw: 0.4 });
      return scene;
    },
  ],
]);
