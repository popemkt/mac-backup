/**
 * The scene contract (`sceneContract`, `@kb/ui-test-kit`) over the scenes the
 * page registers: each lab study in `LAB_STUDIES`, the 3D graph in every
 * theme and the 3D canvas. A new study joins by being registered.
 */
import { vi } from "vitest";
import { LAB_STUDIES, type LabSceneInit } from "@kb/lab-ui";
import { TIMING_FALLBACK, type LensEdge, type LensNode } from "@kb/ui-sdk";
import { LENS_THEMES } from "@kb/views";
import type { ScenePalette } from "@kb/scene";
import { sceneContract, type SceneMount } from "@kb/ui-test-kit";
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

const lensNodes: LensNode[] = ["a", "b", "c", "d"].map((id, i) => ({
  id,
  label: `node ${id}`,
  color: "#6366f1",
  size: 3 + i,
  clusterKey: "r",
  tags: [],
  degree: i,
}));
const lensEdges: LensEdge[] = [
  { source: "a", target: "b", kind: "mention", weight: 1 },
  { source: "b", target: "c", kind: "mention", weight: 2 },
];

function labInit(reducedMotion: boolean): LabSceneInit {
  return {
    palette,
    dark: true,
    reducedMotion,
    timing: TIMING_FALLBACK,
    values: {},
    graph: {
      nodes: lensNodes.map((n, i) => ({
        id: n.id,
        label: n.label,
        degree: n.degree,
        cluster: "r",
        recency: i / 4,
        glint: i === 3,
      })),
      edges: lensEdges.map((e) => ({ source: e.source, target: e.target })),
    },
    onHover: () => {},
    onOpen: () => {},
  };
}

/** Every registered scene: the lab's studies, the 3D graph and the 3D canvas. */
const SCENES: readonly (readonly [string, SceneMount])[] = [
  ...Object.entries(LAB_STUDIES).map(([id, study]): readonly [string, SceneMount] => [
    `lab study ${id}`,
    async (host, reduced) => (await study.load())(host, labInit(reduced)),
  ]),
  ...LENS_THEMES.map((theme): readonly [string, SceneMount] => [
    `3D graph, ${theme} theme`,
    async (host, reduced) => {
      const { mountForce3d } = await import("@/components/graph/force3d-scene");
      return mountForce3d(host, {
        nodes: lensNodes,
        edges: lensEdges,
        settings: {
          spread: 150,
          linkDistance: 60,
          autorotate: true,
          showLabels: true,
          labelTopN: 4,
          theme,
          linkStyle: "straight",
        },
        emphasis: { selectedNodeId: null },
        palette,
        link: "rgba(230, 230, 240, 0.3)",
        dark: true,
        reducedMotion: reduced,
        timing: TIMING_FALLBACK,
        onSelect: () => {},
        onOpen: () => {},
        onHover: () => {},
      });
    },
  ]),
  [
    "3D canvas",
    async (host, reduced) => {
      const { mountCanvasScene } = await import("@/components/canvas/canvas-scene");
      const { CanvasCameraRig } = await import("@/components/canvas/canvas-camera-rig");
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
];

sceneContract(SCENES);
