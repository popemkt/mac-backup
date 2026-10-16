/**
 * The scene contract (`sceneContract`, `@kb/ui-test-kit`) over the scenes the
 * page registers: each lab study in `LAB_STUDIES`. A new study joins by being
 * registered; the 3D canvas and the 3D graph run the same suite in
 * `@kb/canvas-ui` and `@kb/graph-ui`.
 */
import { vi } from "vitest";
import { LAB_STUDIES, type LabSceneInit } from "@kb/lab-ui";
import { TIMING_FALLBACK } from "@kb/ui-sdk";
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

const graphNodes = ["a", "b", "c", "d"].map((id, i) => ({ id, label: `node ${id}`, degree: i }));
const graphEdges = [
  { source: "a", target: "b" },
  { source: "b", target: "c" },
];

function labInit(reducedMotion: boolean): LabSceneInit {
  return {
    palette,
    dark: true,
    reducedMotion,
    timing: TIMING_FALLBACK,
    values: {},
    graph: {
      nodes: graphNodes.map((n, i) => ({
        id: n.id,
        label: n.label,
        degree: n.degree,
        cluster: "r",
        recency: i / 4,
        glint: i === 3,
      })),
      edges: graphEdges,
    },
    onHover: () => {},
    onOpen: () => {},
  };
}

/** Every registered scene: the lab's studies. */
const SCENES: readonly (readonly [string, SceneMount])[] = Object.entries(LAB_STUDIES).map(
  ([id, study]): readonly [string, SceneMount] => [
    `lab study ${id}`,
    async (host, reduced) => (await study.load())(host, labInit(reduced)),
  ],
);

sceneContract(SCENES);
