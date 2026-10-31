// The dust form of a send (domain/send.ts) on lively's canvas layer
// (refraction.ts): what you sent comes apart into particles that drift up and
// away like dust in the wind, and your message condenses out of the same dust.
// After the Hiss in Remedy's Control: soft, blurred, dark particulate with
// prismatic fringes and a few red embers.
//
// One particle per cell of a grid over the source's box, taking its color from
// the source's pixels where it starts, so the first frame of a dissolve (and
// the last of a condense) is the text itself. Positions are computed on the
// GPU from the cell and the time alone: no buffers, no CPU work per frame.
// The pixels come from HTML-in-Canvas (the real rendering) when the browser
// has it, else from the glyphs drawn with canvas 2D where the browser laid
// them out (snapshot.ts); both land in one window-sized texture.
import { type Box, cssRgb, type Glyph } from "./snapshot.ts";

export type DustKind = "dissolve" | "condense";

/** A shape behind the glyphs (a message's bubble), for the canvas 2D source. */
export interface DustPlate {
  readonly box: Box;
  readonly radius: number;
  readonly fill: string;
  readonly stroke: string;
}

export interface DustSource {
  readonly kind: DustKind;
  /** The box that comes apart or condenses (window CSS px, when it was taken). */
  readonly rect: Box;
  /**
   * With HTML-in-Canvas, a copy of the source placed where it sits, for the layer's stage (`add`
   * moves it to the source's own place there; removed when the dust settles); else the source drawn
   * by canvas 2D: glyphs over plates.
   */
  readonly copy?: HTMLElement;
  readonly glyphs: ReadonlyArray<Glyph>;
  readonly plates: ReadonlyArray<DustPlate>;
  /** How far the dust travels at the end of a particle's life (CSS px). */
  readonly wind: readonly [number, number];
  readonly duration: number;
  /** How far the source has moved since it was taken (a message scrolling with its thread). */
  readonly shift: () => readonly [number, number];
  /** The first frame with this dust on screen has been drawn: the DOM it stands for may go. */
  readonly shown: () => void;
}

interface Emitter {
  readonly source: DustSource;
  readonly cols: number;
  readonly rows: number;
  readonly step: number;
  readonly seed: number;
  /** Where the source's pixels are in the texture: its own place, so sources never bleed into each other. */
  readonly origin: readonly [number, number];
  start: number;
  shown: boolean;
}

/** Space between sources in the texture (CSS px), wider than the linear filter's reach. */
const ATLAS_GAP = 4;

/** Particles per source at most; the grid coarsens past it. */
const MAX_PARTICLES = 24000;
/** The finest grid step (CSS px): fine enough that the first frame reads as the text. */
const MIN_STEP = 1.5;

const VERTEX = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec2 u_res;
uniform vec4 u_rect;   // x, y, w, h (CSS px), where the source is on screen
uniform vec2 u_origin; // where its pixels are in the texture (each source has its own place there)
uniform float u_step;
uniform float u_cols;
uniform float u_t;     // 0..1
uniform float u_kind;  // 0 dissolve, 1 condense
uniform vec2 u_wind;
uniform vec2 u_shift;
uniform float u_seed;
uniform float u_ratio;
uniform vec3 u_smoke;
uniform vec3 u_ember;
out vec4 v_color;
out float v_soft;
out float v_split;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + u_seed * 91.7) * 43758.5453); }
void main() {
  float id = float(gl_VertexID);
  vec2 cell = vec2(mod(id, u_cols), floor(id / u_cols));
  vec2 s = u_rect.xy + (cell + 0.5 + (vec2(hash(cell), hash(cell + 17.0)) - 0.5) * 0.5) * u_step;
  vec4 c = texture(u_src, (s - u_rect.xy + u_origin) / u_res);
  if (c.a < 0.05 || s.x > u_rect.x + u_rect.z || s.y > u_rect.y + u_rect.w) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  float h1 = hash(cell + 3.1), h2 = hash(cell + 5.7), h3 = hash(cell + 9.3), h4 = hash(cell + 13.9);
  // A front crosses the words with the wind, ragged: a dissolve lets go of them left to right, a
  // condense gathers them in the same order, so the message settles the way the dust blew.
  float along = (s.x - u_rect.x) / max(u_rect.z, 1.0);
  float release = 0.04 + 0.46 * along + 0.2 * h1;
  float span = 0.34 + 0.16 * h2;
  float a = u_kind < 0.5 ? smoothstep(release, release + span, u_t) : 1.0 - smoothstep(release * 0.9, release * 0.9 + span, u_t);
  // A lazy start, then the wind takes it, the lift growing as it goes (warm air under dust). The
  // turbulence is a flow field over the screen, not a wobble per particle: neighbours drift together
  // and the words come apart in wisps and curls, as smoke does.
  float e = a * a * (1.6 - 0.6 * a);
  vec2 wind = u_wind * (0.8 + 0.4 * h2);
  float k = a * 2.6 + u_seed * 6.283;
  vec2 q = s * vec2(0.021, 0.034);
  vec2 flow = vec2(sin(q.y * 1.7 + k) + 0.5 * sin(q.y * 3.9 + q.x * 1.3 - k * 1.6),
                   cos(q.x * 1.3 - k * 0.8) + 0.5 * cos(q.x * 3.1 + q.y * 0.9 + k * 1.4));
  vec2 drift = (vec2(h3, h4) - 0.5) * (6.0 + 10.0 * h1) * a;
  vec2 p = s + u_shift + wind * e + flow * (5.0 + 20.0 * a) * a + drift;
  // One in twenty-five burns as a Hiss ember for a moment: smaller, brighter, slower to soften.
  float ember = step(0.96, h3) * smoothstep(0.04, 0.25, a) * (1.0 - smoothstep(0.5, 0.85, a));
  float size = u_step * 1.2 + (2.0 + 9.0 * h4) * a * (1.0 - 0.5 * step(0.96, h3));
  // The color leaves the text for smoke; the dust thins as it spreads.
  vec3 rgb = mix(c.rgb, u_smoke, smoothstep(0.0, 0.45, a));
  rgb = mix(rgb, u_ember, ember);
  float alpha = c.a * (1.0 - smoothstep(0.35, 1.0, a)) * mix(1.0, 0.6, smoothstep(0.0, 0.4, a)) + ember * 0.5 * (1.0 - a);
  // A condense hands over to the real message in its last moments.
  if (u_kind > 0.5) alpha *= 1.0 - smoothstep(0.84, 0.98, u_t);
  v_color = vec4(rgb, clamp(alpha, 0.0, 1.0));
  v_soft = smoothstep(0.0, 0.35, a) * (1.0 - 0.5 * ember);
  v_split = 0.14 * smoothstep(0.1, 0.6, a);
  gl_PointSize = size * u_ratio;
  gl_Position = vec4(p.x / u_res.x * 2.0 - 1.0, 1.0 - p.y / u_res.y * 2.0, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec4 v_color;
in float v_soft;
in float v_split;
out vec4 o;
// A point: a crisp square while it is still a piece of a letter, a soft round blur once it is dust.
float lobe(vec2 q) {
  float hard = step(max(abs(q.x), abs(q.y)), 0.5);
  float soft = exp(-dot(q, q) * 9.0);
  return mix(hard, soft, v_soft);
}
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float k = lobe(q), kr = lobe(q + vec2(v_split, 0.0)), kb = lobe(q - vec2(v_split, 0.0));
  // Dispersion: the dust's edges split into Hiss red on one side and the cold blue on the other.
  vec3 rgb = v_color.rgb * k + vec3(1.0, 0.16, 0.2) * max(kr - k, 0.0) + vec3(0.18, 0.62, 1.0) * max(kb - k, 0.0);
  float a = v_color.a * max(k, max(kr, kb));
  if (a < 0.003) discard;
  o = vec4(rgb * a, a);
}`;

export interface Dust {
  /** Begin a dissolve or condense once its pixels are in the texture (`ready`). */
  add(source: DustSource): void;
  /** Whether any dust is still on screen. */
  live(now: number): boolean;
  /** Sources waiting for their pixels (HTML-in-Canvas: until the stage is painted and uploaded). */
  waiting(): boolean;
  /** The texture now holds every waiting source's pixels: start them. */
  ready(now: number): void;
  /** Draw every live source at `now`; the target is cleared and the blend state set by the caller. */
  draw(now: number): void;
  /** Run `upload` with the sources' texture bound to TEXTURE_2D (HTML-in-Canvas uploads the stage into it). */
  upload(upload: () => void): void;
  clear(): void;
}

export interface DustOptions {
  readonly win: Window;
  readonly gl: WebGL2RenderingContext;
  /** The texture unit the sources live on (the scene uses 0). */
  readonly unit: number;
  /**
   * Whether the layer uploads the sources from HTML-in-Canvas itself (it then calls `ready`);
   * otherwise dust draws their glyphs with canvas 2D and is ready at once.
   */
  readonly fromStage: boolean;
}

export function createDust(options: DustOptions): Dust | undefined {
  const { win, gl, unit, fromStage } = options;
  const program = link(gl);
  if (program === undefined) return undefined;
  const vao = gl.createVertexArray();
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  for (const [key, value] of [
    [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
    [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
    [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
    [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
  ] as const) {
    gl.texParameteri(gl.TEXTURE_2D, key, value);
  }
  gl.activeTexture(gl.TEXTURE0);
  let emitters: Array<Emitter> = [];
  const at = (name: string) => gl.getUniformLocation(program, name);
  const u = {
    src: at("u_src"),
    res: at("u_res"),
    rect: at("u_rect"),
    step: at("u_step"),
    cols: at("u_cols"),
    t: at("u_t"),
    kind: at("u_kind"),
    wind: at("u_wind"),
    shift: at("u_shift"),
    seed: at("u_seed"),
    ratio: at("u_ratio"),
    smoke: at("u_smoke"),
    ember: at("u_ember"),
    origin: at("u_origin"),
  };
  /** The texture is a shelf of sources: each new one goes right of the last, a row down when full. */
  let shelf = { x: 0, y: 0, height: 0 };
  const place = (width: number, height: number): readonly [number, number] => {
    if (emitters.length === 0) shelf = { x: 0, y: 0, height: 0 };
    if (shelf.x > 0 && shelf.x + width > win.innerWidth) shelf = { x: 0, y: shelf.y + shelf.height + ATLAS_GAP, height: 0 };
    // Out of room (a window smaller than its sources): start over at the top; the oldest are nearly gone.
    if (shelf.y + height > win.innerHeight) shelf = { x: 0, y: 0, height: 0 };
    const origin = [shelf.x, shelf.y] as const;
    shelf = { x: shelf.x + Math.ceil(width) + ATLAS_GAP, y: shelf.y, height: Math.max(shelf.height, Math.ceil(height)) };
    return origin;
  };
  /** The dust's colors, read once per source (a probe and a canvas read), never per frame. */
  let palette = { smoke: [0.16, 0.16, 0.18] as readonly [number, number, number], ember: [0.88, 0.1, 0.14] as readonly [number, number, number] };
  /** The canvas 2D the glyphs are drawn on, without HTML-in-Canvas. */
  let raster: HTMLCanvasElement | undefined;

  const readColors = () => {
    palette = {
      smoke: cssRgb(win, "var(--lively-dust, #2a2a2e)", palette.smoke),
      ember: cssRgb(win, "var(--lively-dust-ember, #e01b24)", palette.ember),
    };
  };

  /** Draw every waiting and live source's glyphs where they were laid out, and upload the window. */
  const rasterize = () => {
    raster ??= win.document.createElement("canvas");
    raster.width = Math.max(1, win.innerWidth);
    raster.height = Math.max(1, win.innerHeight);
    const context = raster.getContext("2d");
    if (context === null) return;
    context.clearRect(0, 0, raster.width, raster.height);
    context.textBaseline = "middle";
    for (const { source, origin } of emitters) {
      context.save();
      context.translate(origin[0] - source.rect.left, origin[1] - source.rect.top);
      context.beginPath();
      context.rect(source.rect.left, source.rect.top, source.rect.width, source.rect.height);
      context.clip();
      for (const plate of source.plates) {
        context.beginPath();
        context.roundRect(plate.box.left, plate.box.top, plate.box.width, plate.box.height, plate.radius);
        context.fillStyle = plate.fill;
        context.fill();
        context.strokeStyle = plate.stroke;
        context.stroke();
      }
      for (const glyph of source.glyphs) {
        context.font = glyph.font;
        context.fillStyle = glyph.color;
        context.fillText(glyph.text, glyph.x, glyph.y + glyph.height / 2);
      }
      context.restore();
    }
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, raster);
    gl.activeTexture(gl.TEXTURE0);
  };

  const dust: Dust = {
    add: (source) => {
      readColors();
      const area = Math.max(1, source.rect.width * source.rect.height);
      const step = Math.max(MIN_STEP, Math.sqrt(area / MAX_PARTICLES));
      const origin = place(source.rect.width, source.rect.height);
      // A copy moves to its place in the texture by as much as the source's own place on screen.
      const copy = source.copy;
      if (copy !== undefined) {
        const left = Number.parseFloat(copy.style.left) || 0;
        const top = Number.parseFloat(copy.style.top) || 0;
        copy.style.left = `${left + origin[0] - source.rect.left}px`;
        copy.style.top = `${top + origin[1] - source.rect.top}px`;
      }
      emitters.push({
        origin,
        source,
        step,
        cols: Math.ceil(source.rect.width / step),
        rows: Math.ceil(source.rect.height / step),
        seed: (win.performance.now() % 997) / 997,
        start: Number.NaN,
        shown: false,
      });
      if (!fromStage) {
        rasterize();
        dust.ready(win.performance.now());
      }
    },
    live: (now) => emitters.some((emitter) => Number.isNaN(emitter.start) || now - emitter.start < emitter.source.duration),
    waiting: () => emitters.some((emitter) => Number.isNaN(emitter.start)),
    ready: (now) => {
      for (const emitter of emitters) if (Number.isNaN(emitter.start)) emitter.start = now;
    },
    draw: (now) => {
      emitters = emitters.filter((emitter) => {
        const alive = Number.isNaN(emitter.start) || now - emitter.start < emitter.source.duration;
        if (!alive) emitter.source.copy?.remove();
        return alive;
      });
      const started = emitters.filter((emitter) => !Number.isNaN(emitter.start));
      if (started.length === 0) return;
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(u.src, unit);
      gl.uniform2f(u.res, win.innerWidth, win.innerHeight);
      gl.uniform1f(u.ratio, Math.min(2, win.devicePixelRatio || 1));
      const { smoke, ember } = palette;
      gl.uniform3f(u.smoke, ...smoke);
      gl.uniform3f(u.ember, ...ember);
      for (const emitter of started) {
        const { source } = emitter;
        const [dx, dy] = source.shift();
        gl.uniform4f(u.rect, source.rect.left, source.rect.top, source.rect.width, source.rect.height);
        gl.uniform2f(u.origin, emitter.origin[0], emitter.origin[1]);
        gl.uniform1f(u.step, emitter.step);
        gl.uniform1f(u.cols, emitter.cols);
        gl.uniform1f(u.t, Math.min(1, (now - emitter.start) / source.duration));
        gl.uniform1f(u.kind, source.kind === "dissolve" ? 0 : 1);
        gl.uniform2f(u.wind, ...source.wind);
        gl.uniform2f(u.shift, dx, dy);
        gl.uniform1f(u.seed, emitter.seed);
        gl.drawArrays(gl.POINTS, 0, emitter.cols * emitter.rows);
        if (!emitter.shown) {
          emitter.shown = true;
          source.shown();
        }
      }
      gl.bindVertexArray(null);
      gl.activeTexture(gl.TEXTURE0);
    },
    upload: (upload) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      try {
        upload();
      } finally {
        gl.activeTexture(gl.TEXTURE0);
      }
    },
    clear: () => {
      for (const emitter of emitters) emitter.source.copy?.remove();
      emitters = [];
    },
  };
  return dust;
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
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : undefined;
}
