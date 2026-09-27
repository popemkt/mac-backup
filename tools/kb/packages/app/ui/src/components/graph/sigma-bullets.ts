/**
 * The 2D graphs' bullets: every node drawn as the outline draws its bullet,
 * when the theme's form is the bullet (`graph-themes`). What a bullet is
 * stays the outline's own (`lib/bullet-mode`), and the form a GPU draws it
 * in — the shape as uniforms, each node's mark, radii and paints, the colour
 * table and the glyphs' distance field — is `lib/bullet-gpu`'s, which the 3D
 * graph draws from too. This is the sigma node program that draws it: one
 * instanced quad per node, each fragment measuring its distance to the
 * bullet's marks and antialiasing it over one screen pixel, so a bullet is
 * as sharp zoomed in as the outline's is.
 *
 * A 2D node is a disc in the layout's space (`graph-discs`): the disc is
 * what the layout separates, what sigma picks and what labels keep clear
 * of. A bullet stands exactly as far as its disc — its halo when it has
 * one, else its dot or glyph (`bulletExtent`) — so every disc rule holds
 * unchanged, and a plain leaf reads as the disc it always was. Presence is
 * the node colour's alpha, as for a disc (`sigma-emphasis`): a dimmed
 * bullet fades as a dimmed disc does.
 */
import { NodeProgram, type ProgramInfo } from "sigma/rendering";
import type { NodeDisplayData, RenderParams } from "sigma/types";
import { floatColor } from "sigma/utils";
import { BULLET_GEOMETRY, bulletExtent, type BulletAppearance } from "@/lib/bullet-mode";
import {
  BULLET_MARKS,
  BULLET_TABLE_COLUMNS,
  BULLET_UNIFORM_NAMES,
  BULLET_UNIFORMS,
  BulletGlyphs,
  BulletTable,
  bulletTableKey,
  PLAIN_BULLET,
  readBulletPage,
} from "@/lib/bullet-gpu";
import { drawGraphHover, drawGraphLabel } from "./sigma-labels";

/** The node attributes the program reads: the node's entry in the table, and its box per disc radius. */
export interface BulletAttributes {
  readonly bullet: number;
  readonly bulletScale: number;
}

/**
 * One graph's bullets, owned by the sigma that draws them and read by every
 * program instance it makes (sigma draws on more than one context): each
 * uploads the colour table and the glyphs again when their versions move on.
 */
export class SigmaBullets {
  table = new BulletTable([]);
  readonly colors = document.createElement("canvas");
  readonly glyphs = new BulletGlyphs();
  private key: string | null = null;
  /** Unset until the graph reads its tokens: nothing is painted before then. */
  private page: { ink: string; ground: string } | null = null;
  /** Bumped on every repaint of the colour table. */
  version = 0;

  /**
   * The bullets of a graph's nodes, in order: each node's entry and box. The
   * table is built and painted again only when some bullet changed.
   */
  place(bullets: readonly (BulletAppearance | undefined)[]): BulletAttributes[] {
    const key = bulletTableKey(bullets);
    if (key !== this.key) {
      this.key = key;
      this.table = new BulletTable(bullets);
      this.paint();
    }
    return bullets.map((bullet, i) => ({
      bullet: i,
      bulletScale: BULLET_GEOMETRY.box / 2 / bulletExtent(bullet ?? PLAIN_BULLET),
    }));
  }

  /** The page's ink and ground, re-read on an appearance change: a new page paints the table again. */
  setPage(ink: string, ground: string): void {
    if (ink === this.page?.ink && ground === this.page.ground) return;
    this.page = { ink, ground };
    this.paint();
  }

  /** Paint the colour table, and set the glyphs if their face changed or has loaded since. */
  paint(): void {
    if (this.page === null) return;
    this.table.paintColors(this.colors, this.page);
    this.glyphs.paint(readBulletPage(this.page.ink, this.page.ground));
    this.version++;
  }
}

const uniformDeclarations = BULLET_UNIFORM_NAMES.map((name) => `uniform vec4 ${name};`).join("\n");

/** Both stages share the shape's uniforms, so both run at one precision. */
const PRECISION = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;

// language=GLSL
const VERTEX = /* glsl */ `
${PRECISION}
attribute vec4 a_id;
attribute vec4 a_color;
attribute vec2 a_position;
attribute float a_size;
attribute vec4 a_mark;
attribute vec4 a_paint;
attribute vec4 a_alpha;
attribute float a_scale;
attribute vec2 a_corner;

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_correctionRatio;
uniform vec2 u_resolution;
${uniformDeclarations}

varying vec4 v_color;
varying vec4 v_mark;
varying vec4 v_paint;
varying vec4 v_alpha;
varying vec2 v_box;
varying float v_pixel;
varying float v_scale;

const float bias = 255.0 / 254.0;

void main() {
  // The disc's radius in the framed graph's space, as sigma's own node programs have it.
  float radius = a_size * u_correctionRatio / u_sizeRatio * 2.0;
  float extent = radius * a_scale;
  gl_Position = vec4((u_matrix * vec3(a_position + a_corner * extent, 1)).xy, 0, 1);
  // Where this corner is in the bullet's box (px of the box, y down), and how
  // much of the box one device pixel spans there.
  float boxHalf = u_bulletGlyph.z * 0.5;
  v_box = vec2(a_corner.x, -a_corner.y) * boxHalf;
  vec2 across = (u_matrix * vec3(extent, 0.0, 0.0)).xy * u_resolution * 0.5;
  v_pixel = boxHalf / max(length(across), 1e-6);
  v_scale = a_scale;
  v_mark = a_mark;
  v_paint = a_paint;
  v_alpha = a_alpha;
  #ifdef PICKING_MODE
  v_color = a_id;
  #else
  v_color = a_color;
  #endif
  v_color.a *= bias;
}
`;

const MARK = BULLET_MARKS;
const COLUMN = BULLET_TABLE_COLUMNS;

// language=GLSL
const FRAGMENT = /* glsl */ `
${PRECISION}
varying vec4 v_color;
varying vec4 v_mark;
varying vec4 v_paint;
varying vec4 v_alpha;
varying vec2 v_box;
varying float v_pixel;
varying float v_scale;

uniform sampler2D u_table;
uniform sampler2D u_glyphs;
uniform vec2 u_tableSize;
${uniformDeclarations}

const float TAU = 6.283185307179586;

/** One colour of this bullet's row. */
vec3 texel(float column) {
  return texture2D(u_table, (vec2(v_paint.x + column, v_paint.y) + 0.5) / u_tableSize).rgb;
}

/** How much of this pixel a mark covers, from its signed distance (px of the box). */
float cover(float d) {
  return clamp(0.5 - d / v_pixel, 0.0, 1.0);
}

/** Which of n equal wedges p falls in, clockwise from the top (CSS conic-gradient's). */
float wedge(vec2 p, float n) {
  float turn = fract(atan(p.x, -p.y) / TAU + 1.0);
  return min(floor(turn * n), n - 1.0);
}

float ring(vec2 p) {
  float radial = abs(length(p) - u_bulletRing.x) - u_bulletRing.y;
  float angle = atan(p.y, p.x);
  angle = angle < 0.0 ? angle + TAU : angle;
  float along = mod(angle * u_bulletRing.x, u_bulletRing.z);
  return max(radial, abs(along - u_bulletRing.w * 0.5) - u_bulletRing.w * 0.5);
}

float magnifier(vec2 p) {
  float lens = abs(length(p - u_bulletLens.xy) - u_bulletLens.z) - u_bulletLens.w;
  vec2 a = p - u_bulletHandle.xy;
  vec2 b = u_bulletHandle.zw - u_bulletHandle.xy;
  float handle = length(a - b * clamp(dot(a, b) / dot(b, b), 0.0, 1.0)) - u_bulletLens.w;
  return min(lens, handle);
}

float glyph(vec2 p, float cell) {
  vec2 at = p / u_bulletGlyph.z + 0.5;
  float field = texture2D(u_glyphs, vec2((cell + at.x) / u_bulletGlyph.x, at.y)).r;
  return (0.5 - field) * 2.0 * u_bulletGlyph.y;
}

/** Lay a mark of colour c at strength a over what is there (premultiplied). */
vec4 lay(vec4 under, vec3 c, float a) {
  return mix(under, vec4(c, 1.0), a);
}

void main(void) {
  vec2 p = v_box;
  #ifdef PICKING_MODE
  // A bullet is picked as far as its disc, as a disc is.
  if (length(p) / (u_bulletGlyph.z * 0.5) * v_scale > 1.0) discard;
  gl_FragColor = v_color;
  #else
  float mark = v_mark.x;
  float r = length(p);
  float halo = v_mark.y > 0.0 ? cover(r - v_mark.y) : 0.0;
  bool isRing = abs(mark - ${MARK.ring}.0) < 0.5;
  float dotted = isRing || abs(mark - ${MARK.dot}.0) < 0.5 ? cover(r - v_mark.z) : 0.0;
  float ringed = isRing ? cover(ring(p)) : 0.0;
  float inked = abs(mark - ${MARK.magnifier}.0) < 0.5
    ? cover(magnifier(p))
    : abs(mark - ${MARK.glyph}.0) < 0.5 ? cover(glyph(p, v_mark.w)) : 0.0;
  float shown = max(max(halo, dotted), max(ringed, inked));
  if (shown <= 0.0) discard;
  // The page's ground lies under the bullet wherever it shows; the halo, the
  // ring, the dot and the ink are laid over it in the outline's order.
  vec4 o = vec4(texel(${COLUMN.ground}.0) * shown, shown);
  o = lay(o, texel(${COLUMN.halo}.0 + wedge(p, v_paint.z)), v_alpha.x * halo);
  o = lay(o, texel(${COLUMN.ring}.0), v_alpha.w * ringed);
  o = lay(o, texel(${COLUMN.halo}.0 + v_paint.z + wedge(p, v_paint.w)), v_alpha.y * dotted);
  o = lay(o, texel(${COLUMN.ink}.0), v_alpha.z * inked);
  // Sigma blends premultiplied; presence is the colour's alpha.
  gl_FragColor = o * v_color.a;
  #endif
}
`;

const { FLOAT, UNSIGNED_BYTE, TRIANGLES } = WebGLRenderingContext;
const UNIFORMS = [
  "u_matrix",
  "u_sizeRatio",
  "u_correctionRatio",
  "u_resolution",
  "u_table",
  "u_glyphs",
  "u_tableSize",
  ...BULLET_UNIFORM_NAMES,
] as const;
type Uniform = (typeof UNIFORMS)[number];

/** A quad's two triangles, as corners of the unit square round the centre. */
const QUAD = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, -1],
  [1, 1],
  [-1, 1],
];

type GL = WebGLRenderingContext | WebGL2RenderingContext;

/** A texture this program keeps, uploaded again when its source's version moves on. */
class Upload {
  private texture: WebGLTexture | null = null;
  private seen = -1;
  private readonly filter: "nearest" | "linear";

  constructor(filter: "nearest" | "linear") {
    this.filter = filter;
  }

  bind(gl: GL, unit: number, source: HTMLCanvasElement, version: number): void {
    this.texture ??= gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    if (this.seen === version) return;
    this.seen = version;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    const filter = this.filter === "nearest" ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  }

  dispose(gl: GL): void {
    if (this.texture !== null) gl.deleteTexture(this.texture);
    this.texture = null;
  }
}

/** The sigma node program drawing each node as its bullet, from `bullets`. */
export function createBulletProgram(bullets: SigmaBullets) {
  return class BulletProgram extends NodeProgram<Uniform> {
    override drawLabel = drawGraphLabel;
    override drawHover = drawGraphHover;
    private readonly table = new Upload("nearest");
    private readonly glyphs = new Upload("linear");

    getDefinition() {
      return {
        VERTICES: QUAD.length,
        VERTEX_SHADER_SOURCE: VERTEX,
        FRAGMENT_SHADER_SOURCE: FRAGMENT,
        METHOD: TRIANGLES,
        UNIFORMS,
        ATTRIBUTES: [
          { name: "a_position", size: 2, type: FLOAT },
          { name: "a_size", size: 1, type: FLOAT },
          { name: "a_color", size: 4, type: UNSIGNED_BYTE, normalized: true },
          { name: "a_id", size: 4, type: UNSIGNED_BYTE, normalized: true },
          { name: "a_mark", size: 4, type: FLOAT },
          { name: "a_paint", size: 4, type: FLOAT },
          { name: "a_alpha", size: 4, type: FLOAT },
          { name: "a_scale", size: 1, type: FLOAT },
        ],
        CONSTANT_ATTRIBUTES: [{ name: "a_corner", size: 2, type: FLOAT }],
        CONSTANT_DATA: QUAD,
      };
    }

    processVisibleItem(nodeIndex: number, startIndex: number, data: NodeDisplayData): void {
      const { bullet, bulletScale } = data as NodeDisplayData & Partial<BulletAttributes>;
      const { table } = bullets;
      const at = (bullet ?? 0) * 4;
      const array = this.array;
      let i = startIndex;
      array[i++] = data.x;
      array[i++] = data.y;
      array[i++] = data.size;
      array[i++] = floatColor(data.color);
      array[i++] = nodeIndex;
      for (const source of [table.mark, table.paint, table.alpha])
        for (let k = 0; k < 4; k++) array[i++] = source[at + k] ?? 0;
      array[i] = bulletScale ?? 1;
    }

    setUniforms(params: RenderParams, { gl, uniformLocations }: ProgramInfo<Uniform>): void {
      gl.uniform1f(uniformLocations.u_correctionRatio, params.correctionRatio);
      gl.uniform1f(uniformLocations.u_sizeRatio, params.sizeRatio);
      gl.uniformMatrix3fv(uniformLocations.u_matrix, false, params.matrix);
      gl.uniform2f(
        uniformLocations.u_resolution,
        params.width * params.pixelRatio,
        params.height * params.pixelRatio,
      );
      for (const name of BULLET_UNIFORM_NAMES)
        gl.uniform4fv(uniformLocations[name], [...BULLET_UNIFORMS[name]]);
      const { table } = bullets;
      gl.uniform2f(uniformLocations.u_tableSize, table.width, table.height);
      this.table.bind(gl, 0, bullets.colors, bullets.version);
      gl.uniform1i(uniformLocations.u_table, 0);
      this.glyphs.bind(gl, 1, bullets.glyphs.canvas, bullets.glyphs.version);
      gl.uniform1i(uniformLocations.u_glyphs, 1);
    }

    override kill(): void {
      const { gl } = this.normalProgram;
      this.table.dispose(gl);
      this.glyphs.dispose(gl);
      super.kill();
    }
  };
}
