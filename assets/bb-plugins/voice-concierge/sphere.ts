// The talking sphere. Silent, it is a perfect, softly breathing circle whose life is under the surface; the owner's
// voice (microphone) and the concierge's voice (its audio) gently swell it and brighten its light; thinking turns
// the inner movement faster with a slow orbiting shimmer. The look comes from an art style (core/sphere-styles.ts).
// The audio-reactive sphere idea comes from Bruno Simon's "organic sphere" (github.com/brunosimon/organic-sphere,
// no licence); nothing here is taken from it.
//
// Cost: WebGL2, one full-screen triangle per frame (the sphere is analytic, no mesh), drawn at the device pixel
// ratio (crisp, capped at 2); no frames while the page is hidden or the sphere is off screen; with reduced motion,
// one still frame per change.
import { fragmentSource, VERTEX_SOURCE, type SphereStyle } from "./core/sphere-styles.ts";

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
  read(): { mode: SphereMode; levels: Levels };
  /** Told when the visible look changes (for a label next to the sphere). */
  onLook?(look: SphereLook): void;
}

const SPEAKING_ON = 0.035;
const SPEAKING_HOLD_MS = 450;
const BREATH_S = 4;
const UNIFORMS = ["uRes", "uTime", "uBreath", "uLevel", "uListen", "uSpeak", "uThink", "uSpin", "uBubbles"] as const;

interface Program {
  program: WebGLProgram;
  u: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
}

export class Sphere {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly options: SphereOptions;
  private readonly reduced: MediaQueryList;
  private readonly cleanups: (() => void)[] = [];
  private readonly programs = new Map<SphereStyle, Program>();
  private style: SphereStyle;
  private frame = 0;
  private disposed = false;
  private last = 0;
  private clock = 0; // wall time, for the breath
  private drift = 0; // inner movement time: slow, faster while thinking
  private spin = 0; // where the voice lobes are
  private visible = true;
  private look: SphereLook = "idle";
  private speakingUntil = 0;
  private level = 0;
  private weights = { listen: 0, speak: 0, think: 0, connect: 0 };

  constructor(canvas: HTMLCanvasElement, style: SphereStyle, options: SphereOptions) {
    this.canvas = canvas;
    this.style = style;
    this.options = options;
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: "low-power" });
    if (gl === null) throw new Error("WebGL2 is not available");
    this.gl = gl;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
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

  /** Schedule a frame if none is pending (after a resize, a visibility or state change). */
  kick(): void {
    if (this.frame === 0 && !this.disposed) this.frame = requestAnimationFrame(t => this.tick(t));
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    for (const c of this.cleanups) c();
    for (const p of this.programs.values()) this.gl.deleteProgram(p.program);
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  private use(style: SphereStyle): Program {
    let p = this.programs.get(style);
    if (p === undefined) {
      const program = link(this.gl, VERTEX_SOURCE, fragmentSource(style));
      const u = Object.fromEntries(UNIFORMS.map(n => [n, this.gl.getUniformLocation(program, n)])) as Program["u"];
      p = { program, u };
      this.programs.set(style, p);
    }
    const loc = this.gl.getAttribLocation(p.program, "aPos");
    this.gl.enableVertexAttribArray(loc);
    this.gl.vertexAttribPointer(loc, 2, this.gl.FLOAT, false, 0, 0);
    return p;
  }

  private tick(now: number): void {
    this.frame = 0;
    if (document.hidden || !this.visible) return; // resumes on the visibility or intersection change
    const still = this.reduced.matches;
    const dt = this.last === 0 || still ? 0 : Math.min((now - this.last) / 1000, 0.1);
    this.last = still ? 0 : now;

    const { mode, levels } = this.options.read();
    const look = this.lookFor(mode, levels.remote, now);
    if (look !== this.look) {
      this.look = look;
      this.options.onLook?.(look);
    }
    // Loudness is amplitude, smoothed: ~100 ms to rise, ~250 ms to fall.
    const voice = still ? 0 : look === "speaking" ? levels.remote : look === "listening" ? levels.mic : 0;
    const tau = voice > this.level ? 0.1 : 0.25;
    this.level += (voice - this.level) * (dt === 0 ? (still ? 1 : 0) : 1 - Math.exp(-dt / tau));
    // States cross-fade over ~0.4 s.
    const ease = still ? 1 : 1 - Math.exp(-dt / 0.4);
    const w = this.weights;
    w.listen += ((look === "listening" ? 1 : 0) - w.listen) * ease;
    w.speak += ((look === "speaking" ? 1 : 0) - w.speak) * ease;
    w.think += ((look === "thinking" ? 1 : 0) - w.think) * ease;
    w.connect += ((look === "connecting" ? 1 : 0) - w.connect) * ease;

    this.clock += dt;
    this.drift += dt * (1 + 1.6 * w.think + 0.6 * w.connect + 0.5 * this.level);
    this.spin += dt * (0.6 + 1.2 * this.level);
    this.draw(still);
    if (!still) this.kick();
  }

  private lookFor(mode: SphereMode, remote: number, now: number): SphereLook {
    if (mode === "idle" || mode === "connecting" || mode === "thinking") return mode;
    if (remote > SPEAKING_ON) this.speakingUntil = now + SPEAKING_HOLD_MS;
    return now < this.speakingUntil ? "speaking" : "listening";
  }

  private draw(still: boolean): void {
    const { gl, canvas } = this;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const { program, u } = this.use(this.style);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    const w = this.weights;
    // ~4 s breath, 1.2%; a touch deeper while thinking.
    const breath = still ? 1 : 1 + (0.012 + 0.006 * w.think) * Math.sin((this.clock * 2 * Math.PI) / BREATH_S);
    gl.uniform2f(u.uRes, width, height);
    gl.uniform1f(u.uTime, this.drift + 7.3);
    gl.uniform1f(u.uBreath, breath);
    gl.uniform1f(u.uLevel, this.level);
    gl.uniform1f(u.uListen, w.listen);
    gl.uniform1f(u.uSpeak, w.speak);
    gl.uniform1f(u.uThink, w.think);
    gl.uniform1f(u.uSpin, this.spin);
    gl.uniform1f(u.uBubbles, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
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
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`sphere program: ${gl.getProgramInfoLog(p) ?? "link failed"}`);
  return p;
}
