/**
 * `mountStudy` owns its stage until it hands a scene back: a study whose
 * build throws (Embers on WebGL2, a shader error) must not leave a live
 * renderer behind. The stage is a stand-in; what is under test is ownership.
 */
import { describe, expect, it, vi } from "vitest";
import type { LabSceneInit } from "@/components/lab/kit/contract";
import { TIMING_FALLBACK } from "@/lib/timing";

const live = vi.hoisted(() => ({ stages: 0 }));

vi.mock("@/scene/gpu/stage", () => ({
  createStage: () => {
    live.stages += 1;
    return Promise.resolve({
      backend: "WebGL2",
      reveal: () => Promise.resolve(),
      setRunning: () => {},
      invalidate: () => {},
      dispose: () => {
        live.stages -= 1;
      },
    });
  },
}));

const { mountStudy } = await import("./study");

const init: LabSceneInit = {
  palette: { ground: "", edge: "", hue: "", ink: "", accent: "" },
  dark: true,
  reducedMotion: false,
  timing: TIMING_FALLBACK,
  values: {},
  graph: { nodes: [], edges: [] },
  onHover: () => {},
  onOpen: () => {},
};
const host = {} as HTMLElement;
const options = { fov: 40, bloom: { strength: 1, radius: 0.5 } };

describe("mountStudy", () => {
  it("disposes the stage when the study's build throws", async () => {
    await expect(
      mountStudy(host, init, options, () => {
        throw new Error("needs WebGPU");
      }),
    ).rejects.toThrow("needs WebGPU");
    expect(live.stages).toBe(0);
  });

  it("hands a working study's stage to the scene, which disposes it", async () => {
    const released = vi.fn();
    const scene = await mountStudy(host, init, options, () => ({
      frame: () => {},
      setControl: () => {},
      dispose: released,
    }));
    expect(live.stages).toBe(1);
    scene.dispose();
    expect(released).toHaveBeenCalledOnce();
    expect(live.stages).toBe(0);
  });
});
