/**
 * The lab's studies: what each one teaches, which Lab principles it applies
 * (DESIGN-UI.md → Lab principles), its live parameters, and its scene, which
 * is imported only when the study is opened.
 */
import type { LabStudy } from "@/components/lab/kit/contract";
import { TIMING_FALLBACK } from "@/components/lab/kit/timing";
import { CurvePanel } from "@/components/lab/motion/curve-panel";
import type { LabSceneId } from "@/components/lab/routes";

const follow = Math.round(TIMING_FALLBACK.follow * 1000);
const stagger = Math.round(TIMING_FALLBACK.stagger * 1000);

export const LAB_STUDIES: Record<LabSceneId, LabStudy> = {
  embers: {
    label: "Embers",
    technique: "TSL compute: a GPU spatial hash grid, contact heat, and an HDR ramp under bloom",
    teaches:
      "Stir the cloud. Spheres that collide heat up, cool down, and pop when they saturate; only the hot end of the ramp is HDR, so only it blooms.",
    rules: [
      {
        id: "T1",
        how: "The sim is four TSL compute kernels over storage buffers; nothing reads back.",
      },
      {
        id: "M1",
        how: "Every sphere is a critically damped spring home; the centre follows the pointer on another.",
      },
      { id: "M3", how: "Shell springs are softer than the core's, so the shell lags a gesture." },
      { id: "M4", how: "Pops draw on a small budget: rare and crisp, never a barrage." },
      { id: "L2", how: "Bloom's threshold is 1: only heat past it glows." },
      { id: "L3", how: "Distance fades into the ground." },
    ],
    controls: [
      { kind: "range", id: "gain", label: "heat gain", min: 0, max: 3, step: 0.05, value: 0.6 },
      {
        kind: "range",
        id: "cooling",
        label: "cooling rate",
        min: 0.1,
        max: 3,
        step: 0.05,
        value: 0.9,
        unit: "/s",
      },
      {
        kind: "range",
        id: "threshold",
        label: "pop threshold",
        min: 0.4,
        max: 2,
        step: 0.05,
        value: 1,
      },
    ],
    load: () => import("@/components/lab/embers/scene").then((m) => m.mountEmbers),
  },
  motion: {
    label: "Motion",
    technique: "Staggered, critically damped springs against an eased tween",
    teaches:
      "Sweep across the tiles. The spring keeps its velocity when the target moves; switch to ease and every retarget restarts the curve from rest — the hitch is the lesson.",
    rules: [
      { id: "M1", how: "Critically damped springs, never linear." },
      { id: "M3", how: "A small, consistent stagger per neighbour; the glow trails the lift." },
      { id: "M5", how: "Settles in the follow duration (300–600ms)." },
      { id: "M6", how: "Durations and the ease come from the motion tokens." },
    ],
    controls: [
      {
        kind: "range",
        id: "settle",
        label: "settle",
        min: 300,
        max: 600,
        step: 10,
        value: follow,
        unit: "ms",
      },
      {
        kind: "range",
        id: "stagger",
        label: "stagger",
        min: 0,
        max: 60,
        step: 2,
        value: stagger,
        unit: "ms",
      },
      {
        kind: "choice",
        id: "drive",
        label: "drive",
        value: "spring",
        options: [
          { value: "spring", label: "spring" },
          { value: "ease", label: "ease" },
        ],
      },
      { kind: "toggle", id: "overlap", label: "overlap", value: true },
    ],
    Panel: CurvePanel,
    load: () => import("@/components/lab/motion/scene").then((m) => m.mountMotion),
  },
};
