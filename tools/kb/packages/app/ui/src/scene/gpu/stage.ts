/**
 * The stage every real-time 3D view stands on — each lab study and the 3D
 * graph (Lab principles P4): one renderer setup, one post chain, one palette,
 * one frame loop and one reveal, so no view has its own copy of any of them.
 *
 * - Renderer: three's `WebGPURenderer` — WebGPU where the browser has it, its
 *   own WebGL2 backend where it does not; the same TSL compiles to both.
 *   Antialiased, device pixel ratio clamped to 2 (P3).
 * - Colour (L2): a set tone mapping (ACES unless a study compares others) and
 *   sRGB output. Bloom's threshold sits at 1, so only HDR values glow.
 * - Post chain: scene → optional ambient occlusion (GTAO) → bloom → the edges
 *   fade to the ground (P1, L3) → tone mapping and sRGB → dither, a
 *   half-step of noise that breaks 8-bit banding in dark gradients (L4).
 * - Palette (L1): the tokens as uniforms. A theme change eases every study's
 *   colours across at the theme duration (M1), or jumps when nothing may
 *   move (M7).
 * - Loop: dt clamped (M2); stops when asked (hidden tab, reduced motion).
 * - Reveal (P2): shaders are compiled before the first frame is shown, and
 *   the canvas fades in over the ground rather than popping.
 *
 * Only modules that are themselves behind a lazy boundary import this: the
 * lab's study scenes and the 3D graph's chunk (the three boundary tests).
 */
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  Color,
  NoToneMapping,
  PerspectiveCamera,
  PostProcessing,
  Scene,
  WebGPURenderer,
  type ToneMapping,
} from "three/webgpu";
import {
  colorToDirection,
  directionToColor,
  dot,
  float,
  fog,
  fract,
  length,
  mix,
  mrt,
  normalView,
  output,
  pass,
  rangeFogFactor,
  renderOutput,
  sample,
  screenCoordinate,
  screenUV,
  smoothstep,
  uniform,
  vec2,
  vec4,
} from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { ao as gtao } from "three/addons/tsl/display/GTAONode.js";
import type { SceneBackend } from "@/scene/backend";
import { disposeGraph } from "@/scene/gpu/dispose";
import type { ScenePalette } from "@/scene/palette";
import { approachRate, clampStep, type Timing } from "@/lib/timing";

const MAX_PIXEL_RATIO = 2;

export type SceneToneMapping = "agx" | "aces" | "none";

const TONE_MAPPINGS: Record<SceneToneMapping, ToneMapping> = {
  agx: AgXToneMapping,
  aces: ACESFilmicToneMapping,
  none: NoToneMapping,
};

export interface StageOptions {
  readonly fov: number;
  readonly palette: ScenePalette;
  readonly timing: Timing;
  readonly bloom: { readonly strength: number; readonly radius: number };
  /** Build the ambient-occlusion pass (a study that shows contact shadows). */
  readonly ao?: boolean;
  /** How much of the frame's edge fades into the ground, 0–1. */
  readonly vignette?: number;
  /** Advance the study by `dt` seconds (already clamped); `elapsed` is its clock. */
  readonly frame: (dt: number, elapsed: number) => void;
}

/** The palette as uniforms (linear colour): what every study's shaders read. */
function paletteUniforms() {
  return {
    ground: uniform(new Color()),
    edge: uniform(new Color()),
    hue: uniform(new Color()),
    ink: uniform(new Color()),
    accent: uniform(new Color()),
  };
}
export type PaletteUniforms = ReturnType<typeof paletteUniforms>;
type PaletteKey = keyof PaletteUniforms;
const PALETTE_KEYS: readonly PaletteKey[] = ["ground", "edge", "hue", "ink", "accent"];

/** The post chain, and the handles a study turns. */
function postChain(
  renderer: WebGPURenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  options: StageOptions,
  colors: PaletteUniforms,
) {
  const knobs = {
    dither: uniform(1),
    occlusion: uniform(options.ao === true ? 1 : 0),
    vignette: uniform(options.vignette ?? 0.55),
  };
  const scenePass = pass(scene, camera);
  const color = scenePass.getTextureNode("output");
  let lit: ReturnType<typeof color.mul> | typeof color = color;
  let occlusionPass: ReturnType<typeof gtao> | null = null;
  if (options.ao === true) {
    scenePass.setMRT(mrt({ output, normal: directionToColor(normalView) }));
    const normals = scenePass.getTextureNode("normal");
    occlusionPass = gtao(
      scenePass.getTextureNode("depth"),
      sample((uv) => colorToDirection(normals.sample(uv))),
      camera,
    );
    occlusionPass.resolutionScale = 0.5;
    const occlusion = occlusionPass.getTextureNode().sample(screenUV).r;
    lit = lit.mul(mix(float(1), occlusion, knobs.occlusion));
  }
  const glow = bloom(lit, options.bloom.strength, options.bloom.radius, 1);
  const edge = smoothstep(0.45, 1.05, length(screenUV.sub(0.5)).mul(Math.SQRT2)).mul(
    knobs.vignette,
  );
  const framed = mix(lit.add(glow), vec4(colors.ground, 1), edge);
  const display = renderOutput(framed);
  // Interleaved gradient noise: a fixed, even half-step pattern per pixel.
  const noise = fract(
    float(52.9829189).mul(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715)))),
  );
  const post = new PostProcessing(renderer);
  post.outputColorTransform = false;
  post.outputNode = vec4(display.rgb.add(noise.sub(0.5).mul(knobs.dither.div(255))), 1);
  return { post, glow, occlusionPass, knobs };
}

function backendOf(renderer: WebGPURenderer): SceneBackend {
  // Only three's WebGPU backend carries the flag; its WebGL2 fallback has none.
  return "isWebGPUBackend" in renderer.backend ? "WebGPU" : "WebGL2";
}

/** The renderer, its canvas in the host, hidden until the reveal (P2). */
async function mountRenderer(host: HTMLElement): Promise<WebGPURenderer> {
  const renderer = new WebGPURenderer({ antialias: true, powerPreference: "high-performance" });
  await renderer.init();
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  Object.assign(renderer.domElement.style, {
    display: "block",
    width: "100%",
    height: "100%",
    touchAction: "none",
    opacity: "0",
    transition: "opacity var(--motion-duration-reveal) var(--motion-settle)",
  });
  host.appendChild(renderer.domElement);
  return renderer;
}

/**
 * The frame loop and the palette it eases: continuous frames while running,
 * one frame on request otherwise, and the theme's colours approaching their
 * targets on the frames that are drawn.
 */
function frameLoop(
  renderer: WebGPURenderer,
  colors: PaletteUniforms,
  options: StageOptions,
  render: () => void,
) {
  const targets: Record<PaletteKey, Color> = {
    ground: new Color(),
    edge: new Color(),
    hue: new Color(),
    ink: new Color(),
    accent: new Color(),
  };
  const themeRate = approachRate(options.timing.theme);
  let running = false;
  let easing = false;
  let pending = 0;
  let last = -1;
  let elapsed = 0;
  const ease = (dt: number) => {
    if (!easing) return;
    const t = 1 - Math.exp(-themeRate * dt);
    let remaining = 0;
    for (const key of PALETTE_KEYS) {
      const value = colors[key].value;
      value.lerp(targets[key], t);
      remaining += Math.abs(value.r - targets[key].r) + Math.abs(value.b - targets[key].b);
    }
    easing = remaining > 1e-4;
  };
  const draw = (now: number) => {
    const dt = last < 0 ? 0 : clampStep((now - last) / 1000);
    last = now;
    elapsed += dt;
    ease(dt);
    options.frame(dt, elapsed);
    render();
  };
  const invalidate = () => {
    if (running || pending !== 0) return;
    pending = requestAnimationFrame((now) => {
      pending = 0;
      last = -1;
      draw(now);
    });
  };
  const setPalette = (palette: ScenePalette, animate: boolean) => {
    for (const key of PALETTE_KEYS) {
      targets[key].set(palette[key]);
      if (!animate) colors[key].value.copy(targets[key]);
    }
    easing = animate;
    invalidate();
  };
  return {
    draw,
    invalidate,
    /** New theme colours: eased across while the loop runs, set at once otherwise. */
    setPalette: (palette: ScenePalette) => setPalette(palette, running),
    setInitialPalette: (palette: ScenePalette) => setPalette(palette, false),
    setRunning: (next: boolean) => {
      if (next === running) return;
      running = next;
      last = -1;
      void renderer.setAnimationLoop(next ? draw : null);
      invalidate();
    },
    stop: () => {
      running = false;
      if (pending !== 0) cancelAnimationFrame(pending);
      void renderer.setAnimationLoop(null);
    },
  };
}

export async function createStage(host: HTMLElement, options: StageOptions) {
  const renderer = await mountRenderer(host);
  const scene = new Scene();
  const camera = new PerspectiveCamera(options.fov, 1, 0.1, 400);
  const colors = paletteUniforms();
  const chain = postChain(renderer, scene, camera, options, colors);
  const loop = frameLoop(renderer, colors, options, () => chain.post.render());
  loop.setInitialPalette(options.palette);
  const { invalidate } = loop;

  return {
    scene,
    camera,
    renderer,
    colors,
    knobs: chain.knobs,
    backend: backendOf(renderer),
    setPalette: loop.setPalette,
    setRunning: loop.setRunning,
    invalidate,
    setBloom: (strength: number) => {
      chain.glow.strength.value = strength;
      invalidate();
    },
    setToneMapping: (kind: SceneToneMapping) => {
      renderer.toneMapping = TONE_MAPPINGS[kind];
      chain.post.needsUpdate = true;
      invalidate();
    },
    /** The ground as a radial backdrop: the focal point lighter, the edges into `edge`. */
    backdrop: () => {
      // The occlusion pass renders to two targets, and three's background
      // mesh writes only one: under occlusion the ground is a flat clear (the
      // same live colour), and the post chain's edge fade does the vignette.
      if (options.ao === true) {
        scene.background = colors.ground.value;
        return;
      }
      scene.backgroundNode = mix(
        colors.ground,
        colors.edge,
        smoothstep(0.15, 0.95, length(screenUV.sub(0.5)).mul(1.3)),
      );
    },
    /** Atmospheric perspective (L3): distance fades into the ground. */
    atmosphere: (near: number, far: number) => {
      scene.fogNode = fog(colors.ground, rangeFogFactor(near, far));
    },
    resize: (width: number, height: number) => {
      if (width <= 0 || height <= 0) return;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      invalidate();
    },
    /** Compile every shader, draw once unseen, then fade the canvas in (P2). */
    reveal: async () => {
      // `compileAsync` builds a scene's pipelines for a plain one-target draw.
      // Under occlusion the scene renders through a two-target pass, and with
      // shadows three r180 leaves the shadow pass out, so the first frame's
      // command buffer is rejected; those scenes compile on the hidden first
      // frame below instead. GAP [[01M3A8QG4PEQK0A9N3KPQ3K98X]]
      if (options.ao !== true && !renderer.shadowMap.enabled) {
        await renderer.compileAsync(scene, camera);
      }
      loop.draw(performance.now());
      requestAnimationFrame(() => {
        renderer.domElement.style.opacity = "1";
      });
    },
    dispose: () => {
      loop.stop();
      disposeGraph(scene);
      chain.occlusionPass?.dispose();
      chain.glow.dispose();
      chain.post.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

export type SceneStage = Awaited<ReturnType<typeof createStage>>;
