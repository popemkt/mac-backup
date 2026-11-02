// The talking sphere: a soft, physical ball whose surface really moves. Silent, it breathes and is almost still; the
// owner's voice (microphone) ripples it, finer and livelier; the concierge's voice (its audio) swells it, broader and
// rounder; thinking rolls it slowly and turns its inner light. The surface is displaced in the vertex shader and lit
// from its own normals; the look comes from an art style (core/sphere-styles.ts). The audio-reactive sphere idea
// comes from Bruno Simon's "organic sphere" (github.com/brunosimon/organic-sphere, no licence); nothing is taken from it.
//
// Cost: WebGL2, two draws per frame: a full-screen triangle for the halo and an icosphere of 20k triangles (the
// noise runs per vertex, about 10k of them; the style's shading only on the ball's own pixels), 4x MSAA, at the
// device pixel ratio capped at 2 and at most 720 pixels a side; no frames while the page is hidden or the sphere is
// off screen; with reduced motion, one still frame per change. A device that cannot keep up gets fewer pixels.
import { DEFAULT_TUNE, type Tune } from "./core/look.ts";
import { HALO_VERTEX_SOURCE, haloFragmentSource, MESH_VERTEX_SOURCE, meshFragmentSource, type SphereStyle } from "./core/sphere-styles.ts";

/** What the call is doing; the renderer tells speaking from listening by the audio levels. */
export type SphereMode = "idle" | "connecting" | "live" | "thinking";
/** What the sphere shows. */
export type SphereLook = "idle" | "connecting" | "listening" | "thinking" | "speaking";
export interface Levels {
  /** 0..1 loudness of the owner's microphone. */
  mic: number;
  /** 0..1 loudness of the concierge's voice. */
  remote: number;
}

export interface SphereOptions {
  /** Called every frame while drawing: the current call mode and voice levels. */
  read(): { mode: SphereMode; levels: Levels; muted?: boolean };
  /** Told when the visible look changes (for a label next to the sphere). */
  onLook?(look: SphereLook): void;
}

const SPEAKING_ON = 0.035;
const SPEAKING_HOLD_MS = 450;
const BREATH_S = 4;
const UNIFORMS = ["uRes", "uTime", "uFlow", "uBreath", "uLevel", "uListen", "uSpeak", "uThink", "uConnect", "uSpin", "uMute", "uBubbles", "uVivid", "uMotion", "uGlow", "uHue"] as const;
const MAX_SIDE = 720;
const CALM_FRAME_MS = 33; // 30 fps while idle or small: nothing there moves fast
const DETAIL = 5; // icosphere subdivisions: 10242 vertices, 20480 triangles

interface Program {
  program: WebGLProgram;
  u: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
}
interface Programs {
  halo: Program;
  mesh: Program;
}

export class Sphere {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly options: SphereOptions;
  private readonly reduced: MediaQueryList;
  private readonly cleanups: (() => void)[] = [];
  private readonly programs = new Map<SphereStyle, Programs>();
  private readonly haloVao: WebGLVertexArrayObject;
  private readonly meshVao: WebGLVertexArrayObject;
  private readonly meshCount: number;
  private style: SphereStyle;
  private frame = 0;
  private disposed = false;
  private last = 0;
  private clock = 0; // wall time, for the breath
  private drift = 0; // inner movement time: slow, faster while thinking
  private spin = 0; // how far the voice's ripples have travelled
  private flow = 0; // surface time: quicker with the voice
  private visible = true;
  private look: SphereLook = "idle";
  private speakingUntil = 0;
  private level = 0;
  private velocity = 0; // the level is a soft spring: it overshoots a little, like jelly
  private weights = { listen: 0, speak: 0, think: 0, connect: 0, mute: 0 };
  private detail = 1; // render-resolution factor (lower while the sphere is shown small)
  private lastDraw = 0;
  private tune: Tune = DEFAULT_TUNE;
  private quality = 1; // lowered when the device cannot keep up (see adapt)
  private frameMs = 16.7; // smoothed interval between full-rate frames
  private lastFull = 0;
  private lastAdapt = 0;
  private calm = false;

  constructor(canvas: HTMLCanvasElement, style: SphereStyle, options: SphereOptions) {
    this.canvas = canvas;
    this.style = style;
    this.options = options;
    const gl = canvas.getContext("webgl2", { antialias: true, depth: true, alpha: true, premultipliedAlpha: true, powerPreference: "low-power" });
    if (gl === null) throw new Error("WebGL2 is not available");
    this.gl = gl;
    this.haloVao = gl.createVertexArray();
    gl.bindVertexArray(this.haloVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const ico = icosphere(DETAIL);
    this.meshVao = gl.createVertexArray();
    gl.bindVertexArray(this.meshVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, ico.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ico.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.meshCount = ico.indices.length;
    this.use(style); // compile now: a broken shader fails here, where the page can fall back

    this.reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const resize = new ResizeObserver(() => this.kick());
    resize.observe(canvas);
    const seen = new IntersectionObserver(entries => {
      this.visible = entries.some(e => e.isIntersecting);
      this.kick();
    });
    seen.observe(canvas);
    const onChange = () => this.kick();
    document.addEventListener("visibilitychange", onChange);
    this.reduced.addEventListener("change", onChange);
    this.cleanups.push(
      () => resize.disconnect(),
      () => seen.disconnect(),
      () => document.removeEventListener("visibilitychange", onChange),
      () => this.reduced.removeEventListener("change", onChange),
    );
    this.kick();
  }

  setStyle(style: SphereStyle): void {
    if (style === this.style || this.disposed) return;
    this.style = style;
    this.use(style);
    this.kick();
  }

  /** The style's knobs (core/look.ts): vividness, motion, glow and hue. */
  setTune(tune: Tune): void {
    this.tune = tune;
    this.kick();
  }

  /** Render resolution as a share of the canvas's size (the page lowers it while the sphere is shown small). */
  setDetail(detail: number): void {
    this.detail = Math.min(1, Math.max(0.2, detail));
    this.kick();
  }

  /** Schedule a frame if none is pending (after a resize, a visibility or state change). */
  kick(): void {
    if (this.frame === 0 && !this.disposed) this.frame = requestAnimationFrame(t => this.tick(t));
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    for (const c of this.cleanups) c();
    for (const p of this.programs.values()) {
      this.gl.deleteProgram(p.halo.program);
      this.gl.deleteProgram(p.mesh.program);
    }
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  private use(style: SphereStyle): Programs {
    let p = this.programs.get(style);
    if (p === undefined) {
      const make = (vs: string, fs: string): Program => {
        const program = link(this.gl, vs, fs);
        const u = Object.fromEntries(UNIFORMS.map(n => [n, this.gl.getUniformLocation(program, n)])) as Program["u"];
        return { program, u };
      };
      p = { halo: make(HALO_VERTEX_SOURCE, haloFragmentSource(style)), mesh: make(MESH_VERTEX_SOURCE, meshFragmentSource(style)) };
      this.programs.set(style, p);
    }
    return p;
  }

  private tick(now: number): void {
    this.frame = 0;
    if (document.hidden || !this.visible) return; // resumes on the visibility or intersection change
    const still = this.reduced.matches;
    const dt = this.last === 0 || still ? 0 : Math.min((now - this.last) / 1000, 0.1);
    this.last = still ? 0 : now;

    const { mode, levels, muted = false } = this.options.read();
    const look = this.lookFor(mode, levels.remote, now);
    if (look !== this.look) {
      this.look = look;
      this.options.onLook?.(look);
    }
    // Calm looks (idle, or the sphere shown small) draw at 30 fps.
    if (!still && (look === "idle" || this.detail < 1) && now - this.lastDraw < CALM_FRAME_MS) {
      this.kick();
      return;
    }
    const dtCalm = this.lastDraw === 0 || still ? dt : Math.min((now - this.lastDraw) / 1000, 0.1);
    this.lastDraw = now;
    // Loudness, compressed (quiet speech already moves it, shouting does not blow it up), followed by a soft
    // underdamped spring (~3.5 Hz, damping 0.5): it swells and settles like jelly.
    const raw = still ? 0 : look === "speaking" ? levels.remote : look === "listening" ? levels.mic : 0;
    const voice = Math.tanh(2.2 * raw);
    if (still || dtCalm === 0) {
      this.level = voice;
      this.velocity = 0;
    } else {
      const omega = 2 * Math.PI * 3.5;
      const steps = Math.ceil(dtCalm / 0.008);
      const h = dtCalm / steps;
      for (let i = 0; i < steps; i++) {
        this.velocity += (omega * omega * (voice - this.level) - 2 * 0.5 * omega * this.velocity) * h;
        this.level += this.velocity * h;
      }
      this.level = Math.max(0, Math.min(1.15, this.level));
    }
    // States cross-fade over ~0.4 s.
    const ease = still ? 1 : 1 - Math.exp(-dtCalm / 0.4);
    const w = this.weights;
    w.listen += ((look === "listening" ? 1 : 0) - w.listen) * ease;
    w.speak += ((look === "speaking" ? 1 : 0) - w.speak) * ease;
    w.think += ((look === "thinking" ? 1 : 0) - w.think) * ease;
    w.connect += ((look === "connecting" ? 1 : 0) - w.connect) * ease;
    w.mute += ((muted && mode !== "idle" ? 1 : 0) - w.mute) * ease;

    // The motion knob speeds the inner drift up or slows it down, and at 0 stops it (the displacement and the breath
    // scale with it too); the voice still brightens the sphere.
    const pace = this.tune.motion;
    if (!still) this.adapt(now, look);
    this.clock += dtCalm;
    this.drift += dtCalm * pace * (1 + 1.6 * w.think + 0.6 * w.connect + 0.5 * this.level);
    this.spin += dtCalm * pace * (0.6 + 0.8 * this.level);
    this.flow += dtCalm * pace * Math.min(0.5 + 1.0 * this.level, 1.2);
    this.draw(still);
    if (!still) this.kick();
  }

  /**
   * Adaptive resolution: a slow device gets fewer pixels, a step a second down to 55%, and gets them back slowly when
   * it has room to spare. At full rate "slow" is frames over ~26 ms (under ~38 fps); at the calm 30 fps (idle, or
   * shown small), frames over ~50 ms.
   */
  private adapt(now: number, look: SphereLook): void {
    const calm = look === "idle" || this.detail < 1;
    if (calm !== this.calm) {
      this.calm = calm;
      this.lastFull = 0;
      this.frameMs = calm ? CALM_FRAME_MS : 16.7;
    }
    if (this.lastFull !== 0) this.frameMs += (Math.min(now - this.lastFull, 150) - this.frameMs) * 0.05;
    this.lastFull = now;
    if (now - this.lastAdapt < 1000) return;
    const [slow, easy] = calm ? [50, CALM_FRAME_MS + 4] : [26, 18];
    if (this.frameMs > slow && this.quality > 0.55) {
      this.quality = Math.max(0.55, this.quality * 0.88);
      this.lastAdapt = now;
    } else if (this.frameMs < easy && this.quality < 1 && now - this.lastAdapt > 4000) {
      this.quality = Math.min(1, this.quality + 0.05);
      this.lastAdapt = now;
    }
  }

  private lookFor(mode: SphereMode, remote: number, now: number): SphereLook {
    if (mode === "idle" || mode === "connecting" || mode === "thinking") return mode;
    if (remote > SPEAKING_ON) this.speakingUntil = now + SPEAKING_HOLD_MS;
    return now < this.speakingUntil ? "speaking" : "listening";
  }

  private draw(still: boolean): void {
    const { gl, canvas } = this;
    const coarse = matchMedia("(pointer: coarse)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2) * this.detail * this.quality;
    const side = Math.max(canvas.clientWidth, canvas.clientHeight) * dpr;
    const scale = side > MAX_SIDE ? (dpr * MAX_SIDE) / side : dpr;
    const width = Math.max(1, Math.round(canvas.clientWidth * scale));
    const height = Math.max(1, Math.round(canvas.clientHeight * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const { halo, mesh } = this.use(this.style);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const w = this.weights;
    // ~4 s breath, 2.2%; a touch deeper while thinking.
    const breath = still ? 1 : 1 + (0.022 + 0.006 * w.think) * Math.min(1, this.tune.motion) * Math.sin((this.clock * 2 * Math.PI) / BREATH_S);
    const set = ({ u }: Program) => {
      gl.uniform2f(u.uRes, width, height);
      gl.uniform1f(u.uTime, this.drift + 7.3);
      gl.uniform1f(u.uFlow, this.flow + 3.1);
      gl.uniform1f(u.uBreath, breath);
      gl.uniform1f(u.uLevel, this.level);
      gl.uniform1f(u.uListen, w.listen);
      gl.uniform1f(u.uSpeak, w.speak);
      gl.uniform1f(u.uThink, w.think);
      gl.uniform1f(u.uConnect, w.connect);
      gl.uniform1f(u.uSpin, this.spin);
      gl.uniform1f(u.uMute, w.mute);
      gl.uniform1f(u.uBubbles, 1);
      gl.uniform1f(u.uVivid, this.tune.vividness);
      gl.uniform1f(u.uMotion, still ? 0 : this.tune.motion);
      gl.uniform1f(u.uGlow, this.tune.glow);
      gl.uniform1f(u.uHue, (this.tune.hue * Math.PI) / 180);
    };
    // the halo first, behind; then the ball, opaque, nearest surface wins
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(halo.program);
    set(halo);
    gl.bindVertexArray(this.haloVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.useProgram(mesh.program);
    set(mesh);
    gl.bindVertexArray(this.meshVao);
    gl.drawElements(gl.TRIANGLES, this.meshCount, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  }
}

/** A unit icosphere: the icosahedron, each triangle split in four `detail` times, every vertex pushed onto the sphere. */
export function icosphere(detail: number): { positions: Float32Array; indices: Uint16Array } {
  const t = (1 + Math.sqrt(5)) / 2;
  const verts: number[][] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
    [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map(v => unit(v));
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let i = 0; i < detail; i++) {
    const mid = new Map<string, number>();
    const half = (a: number, b: number) => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      let m = mid.get(key);
      if (m === undefined) {
        const [p, q] = [verts[a]!, verts[b]!];
        m = verts.push(unit([p[0]! + q[0]!, p[1]! + q[1]!, p[2]! + q[2]!])) - 1;
        mid.set(key, m);
      }
      return m;
    };
    faces = faces.flatMap(([a, b, c]) => {
      const [ab, bc, ca] = [half(a!, b!), half(b!, c!), half(c!, a!)];
      return [[a!, ab, ca], [b!, bc, ab], [c!, ca, bc], [ab, bc, ca]];
    });
  }
  return { positions: new Float32Array(verts.flat()), indices: new Uint16Array(faces.flat()) };
}

function unit([x, y, z]: number[]): number[] {
  const l = Math.hypot(x!, y!, z!);
  return [x! / l, y! / l, z! / l];
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`sphere shader: ${gl.getShaderInfoLog(s) ?? "compile failed"}`);
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, "aPos");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`sphere program: ${gl.getProgramInfoLog(p) ?? "link failed"}`);
  return p;
}
