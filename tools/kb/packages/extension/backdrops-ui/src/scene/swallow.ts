/**
 * Swallows: the flying figure. A slim body, a short flat head, long pointed
 * wings swept back like blades, and the forked tail that tells the bird at a
 * glance. The wing is the same three-dimensional beat as the bat's
 * (`wing.ts`); only its planform and gait differ.
 */
import { ellipse, wound, type Figure, type Poly } from "./figure.ts";
import { projectPlan, type PlanPoint, type WingPose } from "./wing.ts";
import type { WingState } from "./gait.ts";

const SHOULDER = [0.1, -0.06] as const;
const SPAN = 2.5;
/** The chord is narrower than the span is long: a swallow wing is a sickle, not a sail. */
const CHORD = 0.74;

/** The outline: the leading edge curving out to the tip, then a smooth trailing edge home with three finger notches. */
const OUTLINE: readonly PlanPoint[] = [
  [0, 0],
  [0.5, -0.06],
  [1.1, -0.04],
  [1.7, 0.05],
  [2.2, 0.26],
  [2.5, 0.58],
  [2.28, 0.5],
  [2.14, 0.56],
  [1.96, 0.5],
  [1.82, 0.56],
  [1.5, 0.52],
  [1.0, 0.58],
  [0.5, 0.62],
  [0.12, 0.46],
];
const LEADING: readonly PlanPoint[] = OUTLINE.slice(0, 6);
const SHAFTS: readonly (readonly PlanPoint[])[] = [
  [
    [0.7, 0.0],
    [2.14, 0.56],
  ],
];

/** `plan` with its chord narrowed. */
function blade(plan: readonly PlanPoint[]): PlanPoint[] {
  return plan.map(([s, t]) => [s, t * CHORD]);
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

/** `forkOpen` is how wide the tail is spread, 0 closed … 1 open. */
export function swallowFigure(state: WingState, forkOpen: number, facing: number): Figure {
  const membranes: Poly[] = [];
  const struts: Poly[] = [];
  for (const side of [-1, 1] as const) {
    const pose = wingPose(state, side);
    membranes.push(wound(projectPlan(blade(OUTLINE), pose, SPAN, 0.72)));
    struts.push(projectPlan(blade(LEADING), pose, SPAN, 0.72));
    for (const shaft of SHAFTS) struts.push(projectPlan(blade(shaft), pose, SPAN, 0.72));
  }
  const fork = 0.1 + 0.16 * forkOpen;
  const solids: Poly[] = [
    wound(ellipse({ cx: 0.02, cy: 0.0, rx: 0.52, ry: 0.1, rotation: -0.04 })),
    wound(ellipse({ cx: 0.5, cy: -0.02, rx: 0.12, ry: 0.085 })),
    wound([0.58, -0.05, 0.7, -0.005, 0.58, 0.03]),
    wound([
      -0.4,
      -0.05,
      -1.3,
      -0.04 - fork,
      -1.62,
      -0.05 - fork,
      -1.28,
      -0.0,
      -1.08,
      0.0,
      -1.28,
      0.0,
      -1.62,
      0.05 + fork,
      -1.3,
      0.04 + fork,
      -0.4,
      0.05,
    ]),
  ];
  const eyes = [{ x: 0.52 - 0.05 * facing, y: -0.04, r: 0.026, weight: 1 }];
  return { membranes, solids, struts, eyes };
}
