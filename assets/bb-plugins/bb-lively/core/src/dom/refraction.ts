// The refraction layer: lively's HTML-in-Canvas effects (drawable.ts). One
// fixed canvas over the window, invisible to the pointer and to assistive
// tech, holding a stage of laid-out HTML it uploads as a texture and draws
// through one shader. It exists only while a scene runs; at rest the window
// is bb's own crisp DOM and nothing else.
//
// A scene's stage is either a snapshot of bb's real DOM (a sanitized clone:
// no ids, no data attributes, no frames or media, inert) placed where the
// original sits, or lively's own lettering. Three scenes, one per canvas
// effect (domain/effects.ts `canvas`):
// - `navigate` (shiftWarp): the thread you leave breaks into slabs that slide
//   apart with prismatic fringes and fade, over the thread you open;
// - `send` (prismEdge): a prism slides along the composer's top edge,
//   refracting the transcript just above it into its colors;
// - `waiting` (hissResonance): the waiting request resonates outward in red
//   echoes, the card itself left untouched, and a chant overlaps in the
//   thread's side margins, for a few seconds once per request (then the
//   CSS half's still state holds: nothing moves on its own for long).
import type { CanvasTrigger } from "../domain/effects.ts";
import type { Drawable } from "./drawable.ts";
import type { Targets } from "./targets.ts";

/** A scene per canvas trigger: an effect's `canvas` names the scene it plays. */
export type SceneKind = CanvasTrigger;

export interface RefractionOptions {
  readonly win: Window;
  readonly targets: Targets;
  readonly drawable: Drawable;
  /** A scene's length in ms (the motion tokens, speed applied); `waiting` has its own (WAITING_MS). */
  readonly duration: (kind: Exclude<SceneKind, "waiting">) => number;
  /** The words the waiting scene chants in the margins (the active preset's). */
  readonly chant: () => ReadonlyArray<string>;
}

export interface Refraction {
  /** Snapshot the open thread now and break it apart; false when there is none, or no GL. */
  navigate(): boolean;
  /** Refract the transcript above the composer; false when there is no composer. */
  send(): boolean;
  /** The open thread waits for the person (true: resonate once for this request, again if it moved) or no longer does (false). */
  waiting(on: boolean): void;
  /** Whether a scene is on screen now. */
  running(): boolean;
  dispose(): void;
}

/** The attribute on lively's canvas, so it is easy to find and never doubled. */
export const REFRACTION_ATTRIBUTE = "data-lively-refraction";

/** The shader mode of each scene; every canvas trigger has one (tests/control.test.ts holds the table to it). */
export const SCENE_MODES: Readonly<Record<SceneKind, number>> = { navigate: 0, send: 1, waiting: 2 };
/** The waiting scene's frame rate: a slow ripple needs no more. */
const WAITING_FPS = 30;
/** How long the Hiss resonates per request: under five seconds, so it needs no pause control (WCAG 2.2.2). */
export const WAITING_MS: number = 4500;
/** Hiss red for the shader, the dark palette's `--lively-art-hiss` (themes/lively-control.css); the echo is light on any canvas. */
const HISS: readonly [number, number, number] = [1, 0.14, 0.16];

const VERTEX = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

// p: window position, (0,0) top left; the stage covers the window, so the texture is sampled at p.
const FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_tex;
uniform int u_mode;
uniform float u_t;      // progress 0..1 (navigate, send), seconds (waiting)
uniform vec2 u_res;     // window size, CSS px
uniform vec4 u_rect;    // send: the refracting band; waiting: the request card (x0, y0, x1, y1 in 0..1)
uniform vec3 u_hiss;
uniform float u_seed;

float hash(float n) { return fract(sin(n * 12.9898 + u_seed * 78.233) * 43758.5453); }
vec4 tap(vec2 q) { return (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) ? vec4(0.0) : texture(u_tex, q); }
/** Three taps split along x: the dispersion of a prism. */
vec4 disperse(vec2 q, float s) {
  vec4 r = tap(q + vec2(s, 0.0)), g = tap(q), b = tap(q - vec2(s, 0.0));
  return vec4(r.r, g.g, b.b, max(g.a, max(r.a, b.a)));
}
vec4 premul(vec4 c) { return vec4(c.rgb * c.a, c.a); }

void main() {
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y);
  vec2 px = 1.0 / u_res;
  if (u_mode == 0) {
    // Shifting architecture: horizontal slabs of uneven height inside the thread's box (u_rect); each
    // slides its own way, some part at a vertical cut, all sink a little; the seams open onto the new
    // thread; the dispersion follows the speed. Nothing leaves the thread's box.
    if (any(lessThan(p, u_rect.xy)) || any(greaterThan(p, u_rect.zw))) { o = vec4(0.0); return; }
    float t = clamp(u_t, 0.0, 1.0);
    float e = t * t * (3.0 - 2.0 * t);
    float rows = 9.0;
    float y = p.y + 0.035 * sin(p.y * 7.0 + u_seed * 6.0);
    float i = floor(y * rows);
    float d = (0.05 + 0.25 * hash(i + 17.0)) * e;
    float drop = (hash(i + 59.0) - 0.3) * 0.05 * e;
    vec2 q;
    if (hash(i + 47.0) > 0.55) {
      // Two halves part at the cut: the left one goes left, the right one right, a gap between.
      float cut = mix(u_rect.x, u_rect.z, 0.25 + 0.5 * hash(i + 31.0));
      if (p.x < cut - d) q = vec2(p.x + d, p.y - drop);
      else if (p.x > cut + d) q = vec2(p.x - d, p.y - drop);
      else { o = vec4(0.0); return; }
    } else {
      q = vec2(p.x - (hash(i) > 0.5 ? d : -d), p.y - drop);
    }
    if (any(lessThan(q, u_rect.xy)) || any(greaterThan(q, u_rect.zw))) { o = vec4(0.0); return; }
    float velocity = 6.0 * t * (1.0 - t) * (d / max(e, 0.001));
    vec4 c = disperse(q, velocity * 0.008 + 1.5 * px.x * e);
    float f = fract(y * rows);
    float gap = 0.004 + 0.07 * e;
    c.a *= smoothstep(0.0, gap, f) * smoothstep(0.0, gap, 1.0 - f);
    c.a *= 1.0 - smoothstep(0.3, 0.95, t);
    o = premul(c);
  } else if (u_mode == 1) {
    // A prism slides along the band above the composer (u_rect), refracting what is under it; it enters
    // and leaves at the band's ends, never past them.
    float t = clamp(u_t, 0.0, 1.0);
    float e = t * t * (3.0 - 2.0 * t);
    float w = 0.09;
    float cx = mix(u_rect.x - w, u_rect.z + w, e);
    float d = (p.x - cx) / w;
    bool inside = all(greaterThan(p, u_rect.xy)) && all(lessThan(p, u_rect.zw)) && abs(d) < 1.0;
    if (!inside) { o = vec4(0.0); return; }
    float lens = 1.0 - d * d;
    float edge = smoothstep(u_rect.y, u_rect.y + 0.04, p.y);
    vec2 q = p + vec2(d * 0.02 * lens, -0.012 * lens);
    vec4 c = disperse(q, 0.008 * lens + 3.0 * px.x);
    c.a = lens * edge * sin(3.14159 * t);
    // The prism's lit edge along the composer's top: a spectral line.
    float line = 1.0 - smoothstep(0.0, 2.0 * px.y, abs(p.y - u_rect.w + 1.0 * px.y));
    vec3 spectrum = 0.5 + 0.5 * cos(6.28318 * (d * 0.5 + vec3(0.0, 0.33, 0.67)));
    c.rgb = mix(c.rgb, spectrum, line);
    c.a = max(c.a, line * lens * sin(3.14159 * t));
    o = premul(c);
  } else {
    // The Hiss: the request echoes outward in red, rippling; the chant in the margins doubles over itself.
    // The card itself (u_rect) is left alone, so it stays crisp and usable.
    vec2 lo = u_rect.xy - 2.0 * px, hi = u_rect.zw + 2.0 * px;
    if (all(greaterThan(p, lo)) && all(lessThan(p, hi))) { o = vec4(0.0); return; }
    vec2 c = (u_rect.xy + u_rect.zw) * 0.5;
    float ripple = 0.0025 * sin(p.y * 90.0 + u_t * 2.4) + 0.0015 * sin(p.x * 50.0 - u_t * 1.7);
    float echo = 0.0;
    for (int k = 1; k <= 4; k++) {
      float fk = float(k);
      float scale = 1.0 - 0.018 * fk - 0.006 * sin(u_t * 1.3 + fk);
      vec2 q = c + (p - c) * scale + vec2(ripple, 0.0);
      echo += tap(q).a * (0.55 / fk);
    }
    // Fade the echo within ~40px of the card.
    vec2 outside = max(max(u_rect.xy - p, p - u_rect.zw), vec2(0.0)) * u_res;
    echo *= 1.0 - smoothstep(4.0, 40.0, length(outside));
    // The chant: lively's own words in the margins, drawn with two red ghosts overlapping it.
    vec2 rq = p + vec2(ripple, 0.0);
    float chant = tap(rq).a * 0.75 + tap(rq + vec2(4.0, 1.0) * px).a * 0.4 + tap(rq - vec2(7.0, 2.0) * px).a * 0.25;
    float breathe = 0.82 + 0.18 * sin(u_t * 0.9);
    float life = smoothstep(0.0, 0.4, u_t) * (1.0 - smoothstep(${(WAITING_MS / 1000 - 1.2).toFixed(1)}, ${(WAITING_MS / 1000).toFixed(1)}, u_t));
    float a = clamp(max(echo * 0.55, chant * 0.5) * breathe, 0.0, 0.6) * life;
    o = vec4(u_hiss * a, a);
  }
}`;

/** Attributes a snapshot never keeps: nothing may find it by bb's or lively's own hooks. */
const DROP_ELEMENTS = "iframe, frame, object, embed, video, audio, canvas, script, [autofocus]";

/**
 * The scrolled descendants of `original` paired with the same nodes in `clone`, taken before
 * the clone is sanitized (which removes nodes and so breaks a walk in tree order).
 */
function scrolled(original: Element, clone: Element): ReadonlyArray<readonly [Element, number, number]> {
  const from = [original, ...original.querySelectorAll("*")];
  const to = [clone, ...clone.querySelectorAll("*")];
  const pairs: Array<readonly [Element, number, number]> = [];
  for (const [index, element] of from.entries()) {
    const target = to[index];
    if (target !== undefined && (element.scrollTop !== 0 || element.scrollLeft !== 0)) pairs.push([target, element.scrollTop, element.scrollLeft]);
  }
  return pairs;
}

function sanitize(clone: Element): void {
  for (const element of clone.querySelectorAll(DROP_ELEMENTS)) {
    if (element.matches("[autofocus]")) element.removeAttribute("autofocus");
    else element.remove();
  }
  for (const element of [clone, ...clone.querySelectorAll("*")]) {
    for (const name of element.getAttributeNames()) {
      if (name === "id" || name === "name" || name === "for" || name.startsWith("data-") || name === "contenteditable") element.removeAttribute(name);
    }
  }
}

interface Scene {
  readonly kind: SceneKind;
  readonly start: number;
  readonly duration: number;
  readonly rect: readonly [number, number, number, number];
  readonly seed: number;
}

/** The refraction layer, or undefined when WebGL 2 does not start (lively then keeps to CSS). */
export function createRefraction(options: RefractionOptions): Refraction | undefined {
  const { win, targets, drawable } = options;
  const doc = win.document;
  for (const stale of doc.querySelectorAll(`[${REFRACTION_ATTRIBUTE}]`)) stale.remove();

  const canvas = doc.createElement("canvas");
  canvas.setAttribute(REFRACTION_ATTRIBUTE, "");
  canvas.setAttribute("aria-hidden", "true");
  canvas.setAttribute("role", "presentation");
  canvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483000;display:none;contain:strict";
  const stage = doc.createElement("div");
  stage.setAttribute("inert", "");
  stage.style.cssText = "position:absolute;inset:0;width:100vw;height:100vh;overflow:hidden;pointer-events:none";
  canvas.append(stage);
  drawable.prepare(canvas, stage);

  const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, alpha: true, antialias: false });
  if (gl === null) return undefined;
  const program = link(gl);
  if (program === undefined) {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return undefined;
  }
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  for (const [key, value] of [
    [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
    [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
    [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
    [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
  ] as const) {
    gl.texParameteri(gl.TEXTURE_2D, key, value);
  }
  const uniform = (name: string) => gl.getUniformLocation(program, name);
  const at = {
    mode: uniform("u_mode"),
    t: uniform("u_t"),
    res: uniform("u_res"),
    rect: uniform("u_rect"),
    hiss: uniform("u_hiss"),
    seed: uniform("u_seed"),
  };
  gl.uniform3f(at.hiss, ...HISS);
  doc.body.append(canvas);

  let scene: Scene | undefined;
  /** The card the Hiss last resonated around, while its request is open. */
  let resonated: Scene["rect"] | undefined;
  let uploaded = false;
  let frame = 0;
  let lastDrawn = 0;
  let disposed = false;

  const stop = () => {
    scene = undefined;
    uploaded = false;
    win.cancelAnimationFrame(frame);
    frame = 0;
    stage.replaceChildren();
    canvas.style.display = "none";
  };

  const render = (now: number) => {
    frame = 0;
    const current = scene;
    if (current === undefined || disposed) return;
    const elapsed = now - current.start;
    const waiting = current.kind === "waiting";
    if (elapsed >= current.duration) {
      stop();
      return;
    }
    frame = win.requestAnimationFrame(render);
    if (!uploaded) return;
    if (waiting && now - lastDrawn < 1000 / WAITING_FPS) return;
    lastDrawn = now;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1i(at.mode, SCENE_MODES[current.kind]);
    gl.uniform1f(at.t, waiting ? elapsed / 1000 : elapsed / current.duration);
    gl.uniform2f(at.res, win.innerWidth, win.innerHeight);
    gl.uniform4f(at.rect, ...current.rect);
    gl.uniform1f(at.seed, current.seed);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  // The stage's rendering is ready: upload it once per scene (a snapshot does not change).
  const painted = () => {
    if (scene === undefined || uploaded || disposed) return;
    try {
      drawable.draw(gl, canvas, stage);
      uploaded = true;
    } catch {
      stop();
    }
  };
  canvas.addEventListener("paint", painted);

  const begin = (kind: SceneKind, children: ReadonlyArray<Element>, rect: Scene["rect"]) => {
    stop();
    const ratio = Math.min(2, win.devicePixelRatio || 1);
    canvas.width = Math.round(win.innerWidth * ratio);
    canvas.height = Math.round(win.innerHeight * ratio);
    stage.replaceChildren(...children);
    canvas.style.display = "block";
    const start = win.performance.now();
    // A different break-up each time, from the clock: no randomness needed.
    scene = { kind, start, duration: kind === "waiting" ? WAITING_MS : options.duration(kind), rect, seed: (start % 997) / 997 };
    drawable.requestPaint(canvas);
    frame = win.requestAnimationFrame(render);
  };

  /**
   * A sanitized copy of `original`, placed where it sits on screen, on the page's own background;
   * `settle` matches its scroll positions to the original's once it is in the document (laid out).
   * bb virtualizes its timeline, so a thread view is ~400–500 nodes on any thread: 20–45 ms to
   * clone and lay out on a CPU-rendered headless Chromium, once per switch or send.
   */
  const snapshot = (original: Element): { readonly copy: HTMLElement; readonly settle: () => void } => {
    const box = original.getBoundingClientRect();
    const copy = doc.createElement("div");
    copy.style.cssText = `position:absolute;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;overflow:hidden;background:var(--canvas, var(--background, Canvas));color:var(--ink, CanvasText)`;
    const clone = original.cloneNode(true) as HTMLElement;
    const scroll = scrolled(original, clone);
    sanitize(clone);
    clone.style.width = "100%";
    clone.style.height = "100%";
    copy.append(clone);
    const settle = () => {
      for (const [element, top, left] of scroll) {
        element.scrollTop = top;
        element.scrollLeft = left;
      }
    };
    return { copy, settle };
  };

  const unit = (box: Pick<DOMRect, "left" | "top" | "right" | "bottom">): Scene["rect"] => [box.left / win.innerWidth, box.top / win.innerHeight, box.right / win.innerWidth, box.bottom / win.innerHeight];

  const chantBlock = (left: number, top: number, width: number, height: number): HTMLElement => {
    const block = doc.createElement("div");
    block.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;overflow:hidden;color:#fff;font:700 11px/1.5 var(--lively-letter-font, sans-serif);letter-spacing:0.18em;text-transform:uppercase;word-break:break-all;opacity:1`;
    const chant = options.chant();
    const lines = Math.ceil(height / 16);
    block.textContent = chant.length === 0 ? "" : Array.from({ length: lines * 2 }, (_, index) => chant[index % chant.length]).join("  ");
    return block;
  };

  return {
    navigate: () => {
      if (disposed) return false;
      const view = doc.querySelector(targets.pageView);
      if (view === null) return false;
      const { copy, settle } = snapshot(view);
      begin("navigate", [copy], unit(view.getBoundingClientRect()));
      settle();
      return true;
    },
    send: () => {
      if (disposed || scene?.kind === "navigate") return false;
      const box = doc.querySelector(targets.focusBox);
      if (box === null) return false;
      const view = box.closest(targets.pageView) ?? doc.querySelector(targets.pageView);
      if (view === null) return false;
      const composer = box.getBoundingClientRect();
      const { copy, settle } = snapshot(view);
      // The band: the transcript's last ~140px above the composer, across its width.
      const band = { left: composer.left, top: Math.max(0, composer.top - 140), right: composer.right, bottom: Math.max(0, composer.top - 140) + 140 };
      begin("send", [copy], unit(band));
      settle();
      return true;
    },
    waiting: (on) => {
      if (disposed) return;
      if (!on) {
        resonated = undefined;
        if (scene?.kind === "waiting") stop();
        return;
      }
      const request = doc.querySelector(`:is(${targets.pageView}) :is(${targets.pendingRequest})`);
      const view = request?.closest(targets.pageView) ?? null;
      if (request === null || view === null) return;
      const card = request.getBoundingClientRect();
      const rect = unit(card);
      // Once per request; again only if its card moved (a resize, a new request).
      const last = resonated;
      if (last !== undefined) {
        const moved = Math.max(...rect.map((value, index) => Math.abs(value - (last[index] ?? value))));
        if (moved * Math.max(win.innerWidth, win.innerHeight) < 2) return;
      }
      // Another scene plays out first; the next poll tries again.
      if (scene !== undefined && scene.kind !== "waiting") return;
      resonated = rect;
      const viewBox = view.getBoundingClientRect();
      const list = view.querySelector(targets.rowList)?.getBoundingClientRect();
      const children: Array<Element> = [snapshot(request).copy];
      // The chant goes in the side margins beside the timeline's column, where nothing is read.
      if (list !== undefined) {
        const margin = 16;
        const left = list.left - viewBox.left - 2 * margin;
        const right = viewBox.right - list.right - 2 * margin;
        const height = Math.max(0, card.top - viewBox.top - 2 * margin);
        if (left >= 72) children.push(chantBlock(viewBox.left + margin, viewBox.top + margin, left, height));
        if (right >= 72) children.push(chantBlock(list.right + margin, viewBox.top + margin, right, height));
      }
      begin("waiting", children, rect);
    },
    running: () => scene !== undefined,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      stop();
      canvas.removeEventListener("paint", painted);
      canvas.remove();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

function link(gl: WebGL2RenderingContext): WebGLProgram | undefined {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (shader === null) return undefined;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : undefined;
  };
  const vertex = compile(gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
  if (vertex === undefined || fragment === undefined) return undefined;
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, "a_pos");
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return undefined;
  gl.useProgram(program);
  return program;
}
