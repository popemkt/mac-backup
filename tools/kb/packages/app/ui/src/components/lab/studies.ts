/**
 * The lab's studies: what each one teaches, which Lab principles it applies
 * (DESIGN-UI.md → Lab principles), its live parameters, and its scene, which
 * is imported only when the study is opened.
 */
import type { LabStudy } from "@/components/lab/kit/contract";
import { TIMING_FALLBACK } from "@/lib/timing";
import { CurvePanel } from "@/components/lab/motion/curve-panel";
import type { LabSceneId } from "@/components/lab/routes";

const follow = Math.round(TIMING_FALLBACK.follow * 1000);
const stagger = Math.round(TIMING_FALLBACK.stagger * 1000);

export const LAB_STUDIES: Record<LabSceneId, LabStudy> = {
  embers: {
    label: "Embers",
    technique: "TSL compute: a GPU spatial hash grid, contact heat, and an HDR ramp under bloom",
    teaches:
      "Stir the cloud. Spheres that collide heat up, cool down, and pop when they saturate; only the hot end of the ramp is HDR, so only it blooms. Switch the look: cel bands and an inverted-hull outline, noise-cracked lava, or thin-film interference — the same heat curve lights all four.",
    rules: [
      {
        id: "T1",
        how: "The sim is four TSL compute kernels over storage buffers; nothing reads back.",
      },
      {
        id: "P2",
        how: "A new look's shaders compile to one side before it is swapped in.",
      },
      {
        id: "M1",
        how: "Every sphere is a critically damped spring home; the centre follows the pointer on another.",
      },
      { id: "M3", how: "Shell springs are softer than the core's, so the shell lags a gesture." },
      { id: "M4", how: "Pops draw on a small budget: rare and crisp, never a barrage." },
      {
        id: "L2",
        how: "Bloom's threshold is 1: only heat past it glows, whichever look shades it.",
      },
      { id: "L3", how: "Distance fades into the ground; ash drifts through heat haze." },
    ],
    controls: [
      {
        kind: "choice",
        id: "look",
        label: "look",
        value: "glow",
        options: [
          { value: "glow", label: "glow" },
          { value: "toon", label: "toon" },
          { value: "molten", label: "molten" },
          { value: "film", label: "thin film" },
        ],
      },
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
  sky: {
    label: "Sky",
    technique: "A sun that lights the moon, stars in 3D, a domain-warped nebula, orbit controls",
    teaches:
      "Drag the sky to orbit, scroll to dolly; drag the sun, the moon or a star to move it. The moon is shaded by the sun's direction from each point of it, so its terminator and phase follow the two bodies; the night side keeps a little earthshine. Near constellations slide across far ones: parallax is depth. Turn dither off to see a dark gradient band.",
    rules: [
      {
        id: "M3",
        how: "An orbit coasts on release; a dolly or a flight eases in on the motion tokens.",
      },
      { id: "M4", how: "The one ambient motion is a slow constant drift of the orbit." },
      {
        id: "L2",
        how: "The sun is the only light, and the only thing past 1: bloom carries its corona out.",
      },
      {
        id: "L3",
        how: "Stars and dust stand at depth, sized by distance, so moving the eye reveals it.",
      },
      { id: "L4", how: "A half-step of interleaved-gradient noise kills banding." },
      {
        id: "P5",
        how: "The camera flies to the sun by day and the moon by night; a daytime moon lets the sky through its dark side.",
      },
    ],
    controls: [
      {
        kind: "range",
        id: "spikes",
        label: "glint length",
        min: 0.2,
        max: 1,
        step: 0.02,
        value: 1,
      },
      { kind: "range", id: "nebula", label: "nebula", min: 0, max: 0.8, step: 0.02, value: 0.32 },
      {
        kind: "range",
        id: "earthshine",
        label: "earthshine",
        min: 0,
        max: 0.2,
        step: 0.005,
        value: 0.05,
      },
      { kind: "toggle", id: "dither", label: "dither", value: true },
    ],
    load: () => import("@/components/lab/sky/scene").then((m) => m.mountSky),
  },
  glass: {
    label: "Glass",
    technique:
      "Sphere tracing a signed distance field: smooth-min metaballs, refraction, dispersion",
    teaches:
      "Every pixel is a ray stepped through a distance field until it lands on a surface. The blobs are joined by a smooth minimum, so they melt together; move the pointer to push one through the rest. Light refracts in, is traced through the glass and refracts out once per colour — dispersion — and what travels far inside is absorbed.",
    rules: [
      {
        id: "T1",
        how: "The whole march is one TSL node graph on one material; no shader strings.",
      },
      { id: "M1", how: "The held blob follows the pointer on a critically damped spring." },
      { id: "M4", how: "The other six drift on sines no faster than the ambient period." },
      {
        id: "L2",
        how: "Only the studio's light strips run past 1, so only their reflections bloom.",
      },
      { id: "P3", how: "Rays that miss the blobs' bounding sphere skip the march." },
    ],
    controls: [
      { kind: "range", id: "blend", label: "blend", min: 0, max: 1.5, step: 0.02, value: 0.7 },
      { kind: "range", id: "ior", label: "index", min: 1, max: 2.4, step: 0.01, value: 1.45 },
      {
        kind: "range",
        id: "dispersion",
        label: "dispersion",
        min: 0,
        max: 0.12,
        step: 0.005,
        value: 0.03,
      },
      {
        kind: "range",
        id: "density",
        label: "absorption",
        min: 0,
        max: 2,
        step: 0.05,
        value: 0.6,
      },
    ],
    load: () => import("@/components/lab/glass/scene").then((m) => m.mountGlass),
  },
  river: {
    label: "River",
    technique: "A GPU curl-noise flow field: 131 072 particles in a TSL compute kernel",
    teaches:
      "The water is the curl of a noise field. A curl has no divergence, so the flow only swirls — nothing piles up or thins out, as in an incompressible fluid. Each streak is a sprite stretched along its velocity on screen. Stir the water with the pointer; raise turbulence to see the eddies, lower the scale to make them larger.",
    rules: [
      {
        id: "T1",
        how: "One compute kernel advects every particle in storage buffers; nothing reads back.",
      },
      {
        id: "M1",
        how: "A particle's velocity approaches the field's exponentially: it drifts into an eddy.",
      },
      { id: "L2", how: "Only the fastest water runs past 1, so only the rapids bloom." },
      { id: "P2", how: "Particles fade in at birth and out at death: recycling never pops." },
    ],
    controls: [
      { kind: "range", id: "speed", label: "current", min: 0, max: 3, step: 0.05, value: 1 },
      {
        kind: "range",
        id: "scale",
        label: "eddy scale",
        min: 0.1,
        max: 1.2,
        step: 0.02,
        value: 0.45,
      },
      {
        kind: "range",
        id: "turbulence",
        label: "turbulence",
        min: 0,
        max: 3,
        step: 0.05,
        value: 1,
      },
      { kind: "range", id: "streak", label: "streak", min: 0, max: 0.2, step: 0.005, value: 0.06 },
    ],
    load: () => import("@/components/lab/river/scene").then((m) => m.mountRiver),
  },
  ocean: {
    label: "Ocean",
    technique:
      "Gerstner waves, an analytic normal and foam, one sky for the dome, the reflections and the haze",
    teaches:
      "Each point of the sea moves round a circle, so crests sharpen and troughs flatten; long waves travel faster than short ones. The water reflects the sky by Fresnel, glows through thin crests toward the sun, and fades into the horizon the sky itself draws — one sky function, three readers. Lower the sun to lengthen the glitter path.",
    rules: [
      {
        id: "T1",
        how: "The wave sum runs in the vertex stage as TSL; the sky is one WGSL function by setLayout.",
      },
      { id: "L2", how: "Only the sun disc and its glints on the water run past 1 and bloom." },
      {
        id: "L3",
        how: "Distance fades into the sky's own horizon, so the edge of the sea never shows.",
      },
      { id: "M7", how: "Under reduced motion the sea is one still frame of the same waves." },
    ],
    controls: [
      { kind: "range", id: "height", label: "waves", min: 0.05, max: 1, step: 0.01, value: 0.55 },
      {
        kind: "range",
        id: "wavelength",
        label: "wavelength",
        min: 4,
        max: 40,
        step: 0.5,
        value: 14,
        unit: "m",
      },
      {
        kind: "range",
        id: "sun",
        label: "sun height",
        min: -4,
        max: 30,
        step: 0.5,
        value: 6,
        unit: "°",
      },
      { kind: "toggle", id: "foam", label: "foam", value: true },
    ],
    load: () => import("@/components/lab/ocean/scene").then((m) => m.mountOcean),
  },
  light: {
    label: "Light",
    technique: "A key, fill and rim rig, soft shadows, ambient occlusion and tone mapping",
    teaches:
      "Swing the key and watch the soft shadow and the coloured fill; turn occlusion off and the contacts float; turn tone mapping off and the glaze clips.",
    rules: [
      {
        id: "L2",
        how: "A named three-point rig under ACES (compare AgX, which greys a light ground, and none).",
      },
      {
        id: "L5",
        how: "Four finishes with fixed roughness and metalness; never the default grey.",
      },
      {
        id: "L1",
        how: "Every piece takes a palette colour; the matcap is painted from the same palette.",
      },
      { id: "P1", how: "The still life sits at the focal point; the room fades out at the edges." },
    ],
    controls: [
      {
        kind: "choice",
        id: "tone",
        label: "tone mapping",
        value: "aces",
        options: [
          { value: "aces", label: "ACES" },
          { value: "agx", label: "AgX" },
          { value: "none", label: "none" },
        ],
      },
      {
        kind: "choice",
        id: "finish",
        label: "material",
        value: "pbr",
        options: [
          { value: "pbr", label: "PBR" },
          { value: "matcap", label: "matcap" },
        ],
      },
      { kind: "toggle", id: "ao", label: "ambient occlusion", value: true },
      {
        kind: "range",
        id: "key",
        label: "key angle",
        min: 0,
        max: 360,
        step: 1,
        value: 140,
        unit: "°",
      },
    ],
    load: () => import("@/components/lab/light/scene").then((m) => m.mountLight),
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
