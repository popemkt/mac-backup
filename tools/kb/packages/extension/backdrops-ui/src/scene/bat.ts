/**
 * Bats: the flying figure. A small furred body with ears, a tail membrane,
 * and two wings each of an arm and four fingers fanned from the wrist, the
 * skin between them scalloped. Built in three dimensions from the beat
 * (`wing.ts`), so the fingers fold on the up-stroke and open on the down.
 */
import { ellipse, quadTo, wound, type Figure, type Poly } from "./figure.ts";
import { projectPlan, projectWingPoint, type PlanPoint, type WingPose } from "./wing.ts";
import type { WingState } from "./gait.ts";

const SHOULDER = [0.06, -0.09] as const;
const SPAN = 1.55;

const WRIST: PlanPoint = [0.9, -0.04];
const ELBOW: PlanPoint = [0.5, -0.05];
/** The four fingertips, outermost first, and the hip where the skin returns to the body. */
const TIPS: readonly PlanPoint[] = [
  [1.55, 0.12],
  [1.38, 0.58],
  [1.05, 0.92],
  [0.72, 1.04],
];
const HIP: PlanPoint = [0.12, 0.74];
/** How far a scallop of skin is drawn in toward the wrist. */
const SCALLOP = 0.34;

/** A wing's planform at `spread`: fingers draw in as the wing folds. */
function tipsAt(spread: number): PlanPoint[] {
  const k = 0.55 + 0.45 * spread;
  return TIPS.map(([s, t]) => [WRIST[0] + (s - WRIST[0]) * k, WRIST[1] + (t - WRIST[1]) * k]);
}

function scallopped(tips: readonly PlanPoint[], pose: WingPose, scale: number): Poly {
  const edge: PlanPoint[] = [[0, 0], ELBOW, WRIST];
  const out: Poly = projectPlan(edge, pose, SPAN, scale);
  const point = (p: PlanPoint): [number, number] => {
    const tmp: Poly = [];
    projectWingPoint(tmp, p, pose, p[0] / SPAN, scale);
    return [tmp[0] ?? 0, tmp[1] ?? 0];
  };
  const ring = [...tips, HIP];
  let last = point(tips[0] ?? WRIST);
  out.push(last[0], last[1]);
  for (const next of ring.slice(1)) {
    const to = point(next);
    const from = last;
    const wrist = point(WRIST);
    const mid: [number, number] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
    quadTo(
      out,
      from,
      [mid[0] + (wrist[0] - mid[0]) * SCALLOP, mid[1] + (wrist[1] - mid[1]) * SCALLOP],
      to,
      4,
    );
    last = to;
  }
  return out;
}

function wingPose(state: WingState, side: 1 | -1): WingPose {
  return {
    beat: state.beat,
    bend: state.bend,
    sweep: state.sweep,
    spread: state.spread,
    side,
    shoulder: SHOULDER,
  };
}

/** How far the eyes sit apart as the bat turns to face the viewer: 0 side-on, 1 head-on. */
export function batFigure(state: WingState, facing: number): Figure {
  const membranes: Poly[] = [];
  const struts: Poly[] = [];
  for (const side of [-1, 1] as const) {
    const pose = wingPose(state, side);
    const tips = tipsAt(state.spread);
    membranes.push(wound(scallopped(tips, pose, 1)));
    struts.push(projectPlan([[0, 0], ELBOW, WRIST], pose, SPAN, 1));
    for (const tip of tips) struts.push(projectPlan([WRIST, tip], pose, SPAN, 1));
  }
  const solids: Poly[] = [
    wound(ellipse({ cx: 0, cy: 0.02, rx: 0.4, ry: 0.2, rotation: 0.1 })),
    wound(ellipse({ cx: 0.44, cy: -0.03, rx: 0.17, ry: 0.15 })),
    wound(ellipse({ cx: 0.58, cy: 0.01, rx: 0.09, ry: 0.06 })),
    wound([0.37, -0.12, 0.3, -0.44, 0.48, -0.18]),
    wound([0.48, -0.14, 0.55, -0.42, 0.6, -0.08]),
    wound([-0.3, 0.08, -0.58, 0.3, -0.48, 0.36, -0.24, 0.22]),
    wound([-0.22, 0.1, -0.44, 0.18, -0.45, 0.14, -0.26, 0.06]),
    wound([-0.18, 0.2, -0.4, 0.28, -0.41, 0.24, -0.22, 0.16]),
  ];
  const eyes = [
    { x: 0.5 - 0.07 * facing, y: -0.05, r: 0.032, weight: 1 },
    { x: 0.56 - 0.2 * facing, y: -0.07 + 0.02 * facing, r: 0.03, weight: 0.4 + 0.6 * facing },
  ];
  return { membranes, solids, struts, eyes };
}
