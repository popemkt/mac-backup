/**
 * The stage every real-time 3D view stands on — each lab study and the 3D
 * graph (Lab principles P4): one renderer setup, one post chain, one palette,
 * one frame loop and one reveal, so no view has its own copy of any of them.
 *
 * - Renderer: three's `WebGPURenderer` — WebGPU where the browser has it, its
 *   own WebGL2 backend where it does not; the same TSL compiles to both.
 *   Antialiased, device pixel ratio clamped to 2 (P3). Soft shadows when the
 *   view asks for them (`shadows`), decided here once.
 * - Colour (L2): a set tone mapping (ACES unless a study compares others) and
 *   sRGB output. Bloom's threshold is `BLOOM_THRESHOLD`, so only HDR values glow.
 * - Post chain: scene → optional ambient occlusion (GTAO, `ao`, decided once
 *   when the stage is built) → bloom → the edges fade to the ground (P1, L3)
 *   → tone mapping and sRGB → dither, a half-step of noise that breaks 8-bit
 *   banding in dark gradients (L4).
 * - Palette (L1): the tokens as uniforms. A theme change eases every view's
 *   colours across at the theme duration (M1), or jumps when nothing may
 *   move (M7).
 * - Loop: dt clamped (M2). The animation loop runs only while the view is
 *   visible, motion is not reduced, and its frame reports that something
 *   still moves; otherwise a change draws one frame. Under reduced motion
 *   every frame steps by 0: a still composition, never a half-animation (M7).
 * - Reveal (P2): shaders are compiled before the first frame is shown, and
 *   the canvas fades in over the ground rather than popping.
 *
 * `mountScene` is the one way a view becomes a scene: it builds on a stage,
 * reveals it, gives the stage back if the build or the reveal fails, and
 * answers the scene host's handle (`@/scene/host`) from the stage.
 *
 * Only modules that are themselves behind a lazy boundary import this: the
 * lab's study scenes and the 3D graph's chunk (the lazy-chunk fence,
 * `UI_LAZY_ONLY` in harness/src/constraints.ts).
 */
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  Color,
  NoToneMapping,
  PCFSoftShadowMap,
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
import type { SceneHandle } from "@/scene/host";
import { backdropNode, type BackdropOptions } from "@/scene/gpu/backdrop";
import { disposeGraph } from "@/scene/gpu/dispose";
import type { TslNode } from "@/scene/gpu/tsl";
import type { ScenePalette } from "@/scene/palette";
import { BLOOM_THRESHOLD } from "@/scene/shade-ops";
import { approachRate, approachShare, clampStep, type Timing } from "@/lib/timing";

/** The device pixel ratio a stage never exceeds (P3). */
const MAX_PIXEL_RATIO = 2;

export type SceneToneMapping = "agx" | "aces" | "none";

const TONE_MAPPINGS: Record<SceneToneMapping, ToneMapping> = {
  agx: AgXToneMapping,
  aces: ACESFilmicToneMapping,
  none: NoToneMapping,
};

export interface StageOptions {
  readonly fov: number;
  /** The camera's clip range, in world units; a study's default is 0.1–400. */
  readonly near?: number;
  readonly far?: number;
  readonly palette: ScenePalette;
  readonly timing: Timing;
  /** Whether motion is reduced when the stage is built (it can change later). */
  readonly reducedMotion: boolean;
  readonly bloom: { readonly strength: number; readonly radius: number };
  /** Build the ambient-occlusion pass (a study that shows contact shadows). */
  readonly ao?: boolean;
  /** Soft shadow maps (a study whose rig casts shadows). */
  readonly shadows?: boolean;
  /** How much of the frame's edge fades into the ground, 0–1. */
  readonly vignette?: number;
}

/**
 * One frame of a view: advance by `dt` seconds (clamped; 0 under reduced
 * motion), `elapsed` its clock. Returns whether something is still moving,
 * which is what keeps the animation loop running.
 */
type StageFrame = (dt: number, elapsed: number) => boolean;

/** Before a view is built, a frame has nothing to move. */
const still: StageFrame = () => false;

/** What the options decide, once, when the stage is built. */
interface StageBuild {
  readonly options: StageOptions;
  readonly shadows: boolean;
  readonly occluded: boolean;
}

/** The palette as uniforms (linear colour): what every view's shaders read. */
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

/** The post chain, and the handles a view turns. */
function postChain(
  renderer: WebGPURenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  { options, occluded }: StageBuild,
  colors: PaletteUniforms,
) {
  const knobs = {
    dither: uniform(1),
    occlusion: uniform(occluded ? 1 : 0),
    vignette: uniform(options.vignette ?? 0.55),
  };
  const scenePass = pass(scene, camera);
  const color = scenePass.getTextureNode("output");
  let lit: ReturnType<typeof color.mul> | typeof color = color;
  let occlusionPass: ReturnType<typeof gtao> | null = null;
  if (occluded) {
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
  const glow = bloom(lit, options.bloom.strength, options.bloom.radius, BLOOM_THRESHOLD);
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

function pixelRatio(): number {
  return Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
}

/** The renderer, its canvas in the host, hidden until the reveal (P2). */
async function mountRenderer(host: HTMLElement, shadows: boolean): Promise<WebGPURenderer> {
  const renderer = new WebGPURenderer({ antialias: true, powerPreference: "high-performance" });
  await renderer.init();
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.setPixelRatio(pixelRatio());
  if (shadows) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
  }
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
 * The frame loop and the palette it eases. The animation loop runs while the
 * view is visible, motion is not reduced, and the last frame (or the palette
 * ease) still moves; any change otherwise draws one frame on request.
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
  let frame: StageFrame = still;
  let visible = false;
  let reduced = options.reducedMotion;
  let looping = false;
  let moving = true;
  let easing = false;
  let pending = 0;
  let last = -1;
  let elapsed = 0;
  let frames = 0;
  const ease = (dt: number) => {
    if (!easing) return;
    const t = approachShare(themeRate, dt);
    let remaining = 0;
    for (const key of PALETTE_KEYS) {
      const value = colors[key].value;
      value.lerp(targets[key], t);
      remaining += Math.abs(value.r - targets[key].r) + Math.abs(value.b - targets[key].b);
    }
    easing = remaining > 1e-4;
  };
  const sync = () => {
    const wanted = visible && !reduced && (moving || easing);
    if (wanted === looping) return;
    looping = wanted;
    last = -1;
    void renderer.setAnimationLoop(wanted ? draw : null);
  };
  function draw(now: number): void {
    const dt = reduced || last < 0 ? 0 : clampStep((now - last) / 1000);
    last = now;
    elapsed += dt;
    ease(dt);
    frames++;
    moving = frame(dt, elapsed);
    render();
    sync();
  }
  const invalidate = () => {
    moving = true;
    if (!visible) return;
    sync();
    if (looping || pending !== 0) return;
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
    setFrame: (next: StageFrame) => {
      frame = next;
    },
    reduced: () => reduced,
    frames: () => frames,
    /** New theme colours: eased across while the view may move, set at once otherwise. */
    setPalette: (palette: ScenePalette) => setPalette(palette, visible && !reduced),
    setInitialPalette: (palette: ScenePalette) => setPalette(palette, false),
    setVisible: (next: boolean) => {
      visible = next;
      if (next) invalidate();
      else sync();
    },
    setReducedMotion: (next: boolean) => {
      reduced = next;
      invalidate();
    },
    stop: () => {
      visible = false;
      looping = false;
      if (pending !== 0) cancelAnimationFrame(pending);
      void renderer.setAnimationLoop(null);
    },
  };
}

async function createStage(host: HTMLElement, options: StageOptions) {
  const shadows = options.shadows === true;
  const occluded = options.ao === true;
  const build: StageBuild = { options, shadows, occluded };
  const renderer = await mountRenderer(host, shadows);
  const scene = new Scene();
  const camera = new PerspectiveCamera(options.fov, 1, options.near ?? 0.1, options.far ?? 400);
  const colors = paletteUniforms();
  const chain = postChain(renderer, scene, camera, build, colors);
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
    /** Whether the rig may cast shadows on this stage. */
    shadows,
    /** Frames drawn so far (a render spec reads it). */
    frames: loop.frames,
    /** Whether motion is reduced right now. */
    reduced: loop.reduced,
    setFrame: loop.setFrame,
    setPalette: loop.setPalette,
    /** Something changed: draw, and keep drawing while the frame reports motion. */
    invalidate,
    bloomStrength: () => chain.glow.strength.value,
    setBloom: (strength: number) => {
      chain.glow.strength.value = strength;
      invalidate();
    },
    setToneMapping: (kind: SceneToneMapping) => {
      renderer.toneMapping = TONE_MAPPINGS[kind];
      chain.post.needsUpdate = true;
      invalidate();
    },
    /**
     * The ground as a backdrop (`gpu/backdrop`): the focal point lighter, the
     * edges into `edge`, and whatever warmth, haze or rise the view asks for,
     * drifting on its `time` (seconds).
     */
    backdrop: (ground: BackdropOptions & { readonly time?: TslNode } = {}) => {
      // The occlusion pass renders to two targets, and three's background
      // mesh writes only one: under occlusion the ground is a flat clear (the
      // same live colour), and the post chain's edge fade does the vignette.
      if (occluded) {
        scene.background = colors.ground.value;
        return;
      }
      scene.backgroundNode = backdropNode(colors, ground.time ?? float(0), ground);
    },
    /**
     * Atmospheric perspective (L3): distance fades into the ground. The range
     * is two uniforms, so a view whose depth changes (a camera that dollies)
     * moves it without rebuilding a shader.
     */
    atmosphere: (near: number, far: number) => {
      const range = { near: uniform(near), far: uniform(far) };
      scene.fogNode = fog(colors.ground, rangeFogFactor(range.near, range.far));
      return range;
    },
    /** Compile every shader, draw once unseen, then fade the canvas in (P2). */
    reveal: async () => {
      // `compileAsync` builds a scene's pipelines for a plain one-target draw.
      // Under occlusion the scene renders through a two-target pass, and with
      // shadows three r180 leaves the shadow pass out, so the first frame's
      // command buffer is rejected; those scenes compile on the hidden first
      // frame below instead. GAP [[01M3A8QG4PEQK0A9N3KPQ3K98X]]
      if (!occluded && !shadows) await renderer.compileAsync(scene, camera);
      loop.draw(performance.now());
      requestAnimationFrame(() => {
        renderer.domElement.style.opacity = "1";
      });
    },
    /** The scene host's handle, answered by the stage (`@/scene/host`). */
    handle: {
      backend: backendOf(renderer),
      resize: (width: number, height: number) => {
        if (width <= 0 || height <= 0) return;
        renderer.setPixelRatio(pixelRatio());
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        invalidate();
      },
      setRunning: loop.setVisible,
      setReducedMotion: loop.setReducedMotion,
      dispose: () => {
        loop.stop();
        disposeGraph(scene);
        chain.occlusionPass?.dispose();
        chain.glow.dispose();
        chain.post.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      },
    } satisfies SceneHandle,
  };
}

export type SceneStage = Awaited<ReturnType<typeof createStage>>;

/** What a view adds to its stage: its frame, and what the stage does not own. */
export interface SceneParts {
  readonly frame: StageFrame;
  /** After the stage has taken the new size. */
  readonly resize?: (width: number, height: number) => void;
  /** After the stage has taken the new setting. */
  readonly setReducedMotion?: (reduced: boolean) => void;
  /** Release what the stage's scene traversal does not reach (listeners, workers, textures). */
  readonly dispose?: () => void;
}

/**
 * Build a view on a new stage and reveal it. If the build or the reveal
 * fails, the view's parts and the stage are given back before the error goes
 * on: nobody will ever hold a handle to them, so every failed open would
 * otherwise leak a GPU context. The handle is the stage's, extended by the
 * parts.
 */
export async function mountScene<P extends SceneParts>(
  host: HTMLElement,
  options: StageOptions,
  build: (stage: SceneStage) => P,
): Promise<{ readonly stage: SceneStage; readonly parts: P; readonly handle: SceneHandle }> {
  const stage = await createStage(host, options);
  let parts: P | null = null;
  try {
    parts = build(stage);
    stage.setFrame(parts.frame);
    await stage.reveal();
  } catch (error) {
    parts?.dispose?.();
    stage.handle.dispose();
    throw error;
  }
  const built = parts;
  const base = stage.handle;
  return {
    stage,
    parts: built,
    handle: {
      backend: base.backend,
      resize: (width, height) => {
        base.resize(width, height);
        built.resize?.(width, height);
      },
      setRunning: base.setRunning,
      setReducedMotion: (reduced) => {
        base.setReducedMotion(reduced);
        built.setReducedMotion?.(reduced);
      },
      dispose: () => {
        built.dispose?.();
        base.dispose();
      },
    },
  };
}
