/**
 * The scene contract (`sceneContract`, `@kb/ui-test-kit`) over the 3D graph
 * in every theme, as the lab's studies and the 3D canvas run it in their own
 * packages.
 */
import { vi } from "vitest";
import { TIMING_FALLBACK, type LensNode } from "@kb/ui-sdk";
import { type LensEdge, LENS_THEMES } from "@kb/graph";
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

/** The 3D graph in each theme. */
const SCENES: readonly (readonly [string, SceneMount])[] = LENS_THEMES.map(
  (theme): readonly [string, SceneMount] => [
    `3D graph, ${theme} theme`,
    async (host, reduced) => {
      const { mountForce3d } = await import("./force3d-scene");
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
  ],
);

sceneContract(SCENES);
