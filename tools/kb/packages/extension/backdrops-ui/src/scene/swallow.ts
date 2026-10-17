/**
 * Swallows: the flying figure. A slim body, a short flat head, long pointed
 * wings swept back like blades, and the forked tail that tells the bird at a
 * glance. The wing is the same three-dimensional beat as the bat's
 * (`wing.ts`); only its planform and gait differ.
 */
import { ellipse, wound, type Figure, type Poly } from "./figure.ts";
import { projectPlan, type PlanPoint, type WingPose } from "./wing.ts";
import type { WingState } from "./gait.ts";

const SHOULDER = [0.08, -0.07] as const;
const SPAN = 2.25;
/** The chord is narrower than the span is long: a swallow wing is a blade. */
const CHORD = 0.72;

/** The outline: the leading edge to the tip, then the feathered trailing edge home. */
const OUTLINE: readonly PlanPoint[] = [
  [0, 0],
  [0.6, -0.07],
  [1.3, 0.0],
  [1.85, 0.14],
  [2.25, 0.42],
  [1.95, 0.5],
  [1.82, 0.47],
  [1.58, 0.64],
  [1.44, 0.58],
  [1.18, 0.74],
  [1.0, 0.68],
  [0.62, 0.8],
  [0.15, 0.6],
];
const LEADING: readonly PlanPoint[] = OUTLINE.slice(0, 5);
const SHAFTS: readonly (readonly PlanPoint[])[] = [
  [
    [0.9, 0.0],
    [1.82, 0.47],
  ],
  [
    [0.8, 0.0],
    [1.44, 0.58],
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
    membranes.push(wound(projectPlan(blade(OUTLINE), pose, SPAN, 0.8)));
    struts.push(projectPlan(blade(LEADING), pose, SPAN, 0.8));
    for (const shaft of SHAFTS) struts.push(projectPlan(blade(shaft), pose, SPAN, 0.8));
  }
  const fork = 0.1 + 0.1 * forkOpen;
  const solids: Poly[] = [
    wound(ellipse({ cx: 0.02, cy: 0.0, rx: 0.5, ry: 0.12, rotation: -0.04 })),
    wound(ellipse({ cx: 0.5, cy: -0.02, rx: 0.13, ry: 0.1 })),
    wound([0.58, -0.06, 0.72, 0.0, 0.58, 0.03]),
    wound([
      -0.4,
      -0.06,
      -1.1,
      -0.1 - fork,
      -1.3,
      -0.1 - fork - 0.01,
      -0.95,
      -0.02,
      -0.82,
      0.0,
      -0.95,
      0.02,
      -1.3,
      0.1 + fork + 0.01,
      -1.1,
      0.1 + fork,
      -0.4,
      0.06,
    ]),
  ];
  const eyes = [{ x: 0.52 - 0.05 * facing, y: -0.04, r: 0.026, weight: 1 }];
  return { membranes, solids, struts, eyes };
}
