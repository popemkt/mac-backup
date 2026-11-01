// The talking sphere: an organic, noise-displaced sphere that breathes while idle and moves with the voice, the
// owner's microphone while they speak and the concierge's audio while it answers. The idea comes from Bruno Simon's
// "organic sphere" (github.com/brunosimon/organic-sphere, which has no licence); this is written fresh, no code
// taken. The 3D simplex noise is Ashima Arts' / Stefan Gustavson's webgl-noise (MIT).
//
// Cost: WebGL2, one indexed draw of a 10 242-vertex icosphere per frame, drawn at the device pixel ratio (crisp,
// capped at 2), and no frames while the page is hidden or the sphere is off screen. With reduced motion it draws one
// still frame per state change.
import { icosphere } from "./core/sphere-geometry.ts";

/** What the call is doing; the renderer adds speaking vs listening from the audio levels. */
export type SphereMode = "idle" | "connecting" | "live" | "thinking";
/** What the sphere shows. */
export type SphereLook = "idle" | "connecting" | "listening" | "thinking" | "speaking";
export interface Levels {
  /** 0..1 RMS-ish loudness of the owner's microphone. */
  mic: number;
  /** 0..1 loudness of the concierge's voice. */
  remote: number;
}

interface LookParams {
  amp: number; // large-scale displacement
  grain: number; // fine surface displacement
  speed: number; // how fast the noise flows
  freq: number; // noise frequency of the large shapes
  base: [number, number, number];
  vein: [number, number, number];
  glow: [number, number, number];
  light: number;
}

const hex = (h: string): [number, number, number] => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];

const LOOKS: Record<SphereLook, LookParams> = {
  idle: { amp: 0.08, grain: 0.004, speed: 0.12, freq: 0.7, base: hex("#1d2740"), vein: hex("#6f84b8"), glow: hex("#8fa6ff"), light: 0.8 },
  connecting: { amp: 0.1, grain: 0.006, speed: 0.5, freq: 0.8, base: hex("#1d2740"), vein: hex("#8ea2d8"), glow: hex("#b6c6ff"), light: 0.95 },
  listening: { amp: 0.09, grain: 0.006, speed: 0.22, freq: 0.8, base: hex("#0c3534"), vein: hex("#37cfc4"), glow: hex("#7ff5e6"), light: 1 },
  thinking: { amp: 0.12, grain: 0.016, speed: 0.75, freq: 1.25, base: hex("#22153f"), vein: hex("#9a6bff"), glow: hex("#d4b8ff"), light: 1 },
  speaking: { amp: 0.1, grain: 0.008, speed: 0.3, freq: 0.9, base: hex("#43181d"), vein: hex("#ff7a59"), glow: hex("#ffc796"), light: 1.05 },
};

/** How much a loud voice adds on top of a look. */
const VOICE = { amp: 0.3, speed: 1.2, glow: 1.6 };
const SPEAKING_ON = 0.035;
const SPEAKING_HOLD_MS = 450;

const NOISE = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}`;

const VERTEX = /* glsl */ `#version 300 es
precision highp float;
in vec3 aPos;
uniform mat4 uProj;
uniform mat3 uModel;
uniform float uPhase, uAmp, uGrain, uFreq, uCamera;
out vec3 vNormal;
out vec3 vObj;
out vec3 vView;
out float vDisp;
${NOISE}
// Large, slowly flowing lobes (domain-warped noise) plus a fine, faster ripple.
float displace(vec3 p) {
  vec3 q = p * uFreq + vec3(0.0, uPhase * 0.6, uPhase * 0.25);
  vec3 warp = vec3(snoise(q + vec3(1.7, 9.2, 3.1)), snoise(q + vec3(8.3, 2.8, 5.4)), snoise(q + vec3(4.1, 6.7, 1.3)));
  float lobes = snoise(q + 0.55 * warp);
  float ripple = snoise(p * uFreq * 2.8 + vec3(uPhase * 1.4, 0.0, -uPhase));
  return lobes * uAmp + ripple * uGrain;
}
void main() {
  vec3 p = aPos;
  vec3 t = normalize(cross(p, abs(p.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 b = cross(p, t);
  float d = displace(p);
  const float e = 0.012;
  vec3 pt = normalize(p + t * e);
  vec3 pb = normalize(p + b * e);
  vec3 a0 = p * (1.0 + d);
  vec3 a1 = pt * (1.0 + displace(pt));
  vec3 a2 = pb * (1.0 + displace(pb));
  vec3 world = uModel * a0;
  vNormal = uModel * normalize(cross(a1 - a0, a2 - a0));
  vObj = p;
  vDisp = d;
  vView = world - vec3(0.0, 0.0, uCamera);
  gl_Position = uProj * vec4(vView, 1.0);
}`;

const FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vObj;
in vec3 vView;
in float vDisp;
uniform float uPhase, uTime, uGlow, uLight;
uniform vec3 uBase, uVein, uGlowColor;
out vec4 outColor;
${NOISE}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(-vView);
  float facing = max(dot(n, v), 0.0);
  // Surface texture, fixed to the sphere so it moves with it: marbled veins from warped noise, a finer mottling,
  // and a grain that keeps it from looking like plastic.
  vec3 q = vObj * 2.1 + vec3(0.0, uPhase * 0.08, 0.0);
  float warp = snoise(q * 0.8 + vec3(uTime * 0.03));
  float marble = 1.0 - abs(snoise(q * 0.9 + 1.4 * warp));
  float veins = pow(marble, 7.0);
  float mottle = snoise(vObj * 7.5 + warp) * 0.5 + 0.5;
  float grain = snoise(vObj * 42.0) * 0.5 + 0.5;
  vec3 key = normalize(vec3(-0.45, 0.65, 0.6));
  float diffuse = max(dot(n, key), 0.0) * 0.65 + 0.35;
  float spec = pow(max(dot(reflect(-key, n), v), 0.0), 28.0) * 0.4;
  float lift = clamp(vDisp * 2.6 + 0.5, 0.0, 1.0);
  vec3 col = mix(uBase, mix(uBase, uVein, 0.55), lift) * diffuse;
  col += uVein * veins * (0.45 + 0.35 * lift);
  col *= 0.86 + 0.14 * mottle;
  col *= 0.94 + 0.06 * grain;
  col += spec;
  float rim = pow(1.0 - facing, 2.4);
  col += uGlowColor * rim * uGlow;
  col *= uLight;
  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0; // dither: no banding in the dark gradients
  outColor = vec4(col, 1.0);
}`;

export interface SphereOptions {
  /** Called every frame while drawing; return the current call mode and voice levels. */
  read(): { mode: SphereMode; levels: Levels };
  /** Told when the visible look changes (for a label next to the sphere). */
  onLook?(look: SphereLook): void;
}

export class Sphere {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly count: number;
  private readonly u: Record<string, WebGLUniformLocation | null> = {};
  private readonly options: SphereOptions;
  private readonly reduced: MediaQueryList;
  private readonly cleanups: (() => void)[] = [];
  private frame = 0;
  private last = 0;
  private time = 0;
  private phase = 0;
  private visible = true;
  private look: SphereLook = "idle";
  private speakingUntil = 0;
  private mic = 0;
  private remote = 0;
  private current: LookParams & { glowGain: number } = { ...LOOKS.idle, glowGain: 1 };

  constructor(canvas: HTMLCanvasElement, options: SphereOptions) {
    this.canvas = canvas;
    this.options = options;
    const gl = canvas.getContext("webgl2", { antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: "low-power" });
    if (gl === null) throw new Error("WebGL2 is not available");
    this.gl = gl;
    this.program = link(gl, VERTEX, FRAGMENT);
    const mesh = icosphere(5);
    this.count = mesh.indices.length;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const pos = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pos);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.program, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    const idx = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    for (const name of ["uProj", "uModel", "uPhase", "uTime", "uAmp", "uGrain", "uFreq", "uCamera", "uGlow", "uLight", "uBase", "uVein", "uGlowColor"]) {
      this.u[name] = gl.getUniformLocation(this.program, name);
    }
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);

    this.reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const resize = new ResizeObserver(() => this.kick());
    resize.observe(canvas);
    const seen = new IntersectionObserver(entries => {
      this.visible = entries.some(e => e.isIntersecting);
      this.kick();
    });
    seen.observe(canvas);
    const onVisibility = () => this.kick();
    document.addEventListener("visibilitychange", onVisibility);
    const onReduced = () => this.kick();
    this.reduced.addEventListener("change", onReduced);
    this.cleanups.push(
      () => resize.disconnect(),
      () => seen.disconnect(),
      () => document.removeEventListener("visibilitychange", onVisibility),
      () => this.reduced.removeEventListener("change", onReduced),
    );
    this.kick();
  }

  /** Schedule a frame if one is not pending (after a resize, a visibility change, or a state change). */
  kick(): void {
    if (this.frame === 0) this.frame = requestAnimationFrame(t => this.tick(t));
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    for (const c of this.cleanups) c();
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  private tick(now: number): void {
    this.frame = 0;
    if (document.hidden || !this.visible) return; // resumes on the visibility or intersection change
    const still = this.reduced.matches;
    const dt = this.last === 0 || still ? 0 : Math.min((now - this.last) / 1000, 0.1);
    this.last = still ? 0 : now;

    const { mode, levels } = this.options.read();
    // Fast attack, slower release, so the surface follows syllables without flicker.
    const follow = (prev: number, next: number) => prev + (next - prev) * (next > prev ? 0.45 : 0.12);
    this.mic = still ? 0 : follow(this.mic, levels.mic);
    this.remote = still ? 0 : follow(this.remote, levels.remote);
    const look = this.lookFor(mode, levels.remote, now);
    if (look !== this.look) {
      this.look = look;
      this.options.onLook?.(look);
    }

    const target = LOOKS[look];
    const voice = look === "speaking" ? this.remote : look === "listening" ? this.mic : 0;
    const k = still ? 1 : 1 - Math.exp(-dt * 4);
    const c = this.current;
    const mix = (a: number, b: number) => a + (b - a) * k;
    c.amp = mix(c.amp, target.amp + voice * VOICE.amp);
    c.grain = mix(c.grain, target.grain + voice * 0.012);
    c.speed = mix(c.speed, target.speed + voice * VOICE.speed);
    c.freq = mix(c.freq, target.freq);
    c.light = mix(c.light, target.light);
    c.glowGain = mix(c.glowGain, 0.9 + voice * VOICE.glow);
    for (const key of ["base", "vein", "glow"] as const) c[key] = c[key].map((v, i) => mix(v, target[key][i]!)) as [number, number, number];
    this.time += dt;
    this.phase += dt * c.speed;

    this.draw();
    if (!still) this.kick();
  }

  private lookFor(mode: SphereMode, remote: number, now: number): SphereLook {
    if (mode === "idle" || mode === "connecting") return mode;
    if (mode === "thinking") return "thinking";
    if (remote > SPEAKING_ON) this.speakingUntil = now + SPEAKING_HOLD_MS;
    return now < this.speakingUntil ? "speaking" : "listening";
  }

  private draw(): void {
    const { gl, canvas, u, current: c } = this;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    const camera = 4.4;
    gl.uniformMatrix4fv(u.uProj!, false, perspective((32 * Math.PI) / 180, w / h, 0.1, 20));
    gl.uniformMatrix3fv(u.uModel!, false, rotation(this.time * 0.07, 0.25 + Math.sin(this.time * 0.05) * 0.1));
    gl.uniform1f(u.uPhase!, this.phase);
    gl.uniform1f(u.uTime!, this.time);
    gl.uniform1f(u.uAmp!, c.amp);
    gl.uniform1f(u.uGrain!, c.grain);
    gl.uniform1f(u.uFreq!, c.freq);
    gl.uniform1f(u.uCamera!, camera);
    gl.uniform1f(u.uGlow!, c.glowGain);
    gl.uniform1f(u.uLight!, c.light);
    gl.uniform3fv(u.uBase!, c.base);
    gl.uniform3fv(u.uVein!, c.vein);
    gl.uniform3fv(u.uGlowColor!, c.glow);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0);
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

function perspective(fovy: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovy / 2);
  // Keep the whole sphere in view whatever the canvas shape.
  const fx = aspect >= 1 ? f / aspect : f;
  const fy = aspect >= 1 ? f : f * aspect;
  const nf = 1 / (near - far);
  return new Float32Array([fx, 0, 0, 0, 0, fy, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}

/** Rotation about Y by `yaw`, then about X by `pitch` (column-major 3×3). */
function rotation(yaw: number, pitch: number): Float32Array {
  const [cy, sy, cp, sp] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch)];
  return new Float32Array([cy, sp * sy, -cp * sy, 0, cp, sp, sy, -sp * cy, cp * cy]);
}
