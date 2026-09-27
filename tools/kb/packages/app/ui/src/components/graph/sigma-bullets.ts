/**
 * The 2D graphs' bullets: every node drawn as the outline draws its bullet,
 * when the theme's form is the bullet (`graph-themes`). What a bullet is,
 * and how it is painted, is the outline's own (`lib/bullet-mode`,
 * `lib/bullet-paint`), laid into one atlas (`lib/bullet-atlas`) the 3D
 * graph samples too; this is the sigma node program that samples it, one
 * instanced quad per node.
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
import { BulletAtlas, bulletAtlasKey, PLAIN_BULLET, readBulletPage } from "@/lib/bullet-atlas";
import { drawGraphHover, drawGraphLabel } from "./sigma-labels";

/** The node attributes the program reads: the node's atlas cell, and its box per disc radius. */
export interface BulletAttributes {
  readonly bulletCell: number;
  readonly bulletScale: number;
}

/**
 * One graph's bullet atlas, owned by the sigma that draws it and read by
 * every program instance it makes (sigma draws on more than one context):
 * each uploads the canvas again when its `version` moves on.
 */
export class SigmaBulletAtlas {
  private atlas = new BulletAtlas([]);
  private key: string | null = null;
  /** Unset until the graph reads its tokens: nothing is painted before then. */
  private page: { ink: string; ground: string } | null = null;
  /** Bumped on every repaint: a program re-uploads when it has not seen this one. */
  version = 0;

  get canvas(): HTMLCanvasElement {
    return this.atlas.canvas;
  }

  /** Where cell `c` is on the canvas (`BulletAtlas.cell`). */
  cell(c: number): [number, number, number, number] {
    return this.atlas.cell(c);
  }

  /**
   * The bullets of a graph's nodes, in order: each node's cell and box. The
   * atlas is laid out and painted again only when some bullet's paint changed.
   */
  place(bullets: readonly (BulletAppearance | undefined)[]): BulletAttributes[] {
    const key = bulletAtlasKey(bullets);
    if (key !== this.key) {
      this.key = key;
      this.atlas = new BulletAtlas(bullets);
      this.paint();
    }
    return bullets.map((bullet, i) => ({
      bulletCell: this.atlas.cellOf[i] ?? 0,
      bulletScale: BULLET_GEOMETRY.box / 2 / bulletExtent(bullet ?? PLAIN_BULLET),
    }));
  }

  /** The page's ink and ground, re-read on an appearance change: a new page paints every bullet again. */
  setPage(ink: string, ground: string): void {
    if (ink === this.page?.ink && ground === this.page.ground) return;
    this.page = { ink, ground };
    this.paint();
  }

  /** Paint every bullet again (the UI face has loaded, the page changed). */
  paint(): void {
    if (this.page === null) return;
    this.atlas.paint(readBulletPage(this.page.ink, this.page.ground));
    this.version++;
  }
}

// language=GLSL
const VERTEX = /* glsl */ `
attribute vec4 a_id;
attribute vec4 a_color;
attribute vec2 a_position;
attribute float a_size;
attribute vec4 a_cell;
attribute float a_scale;
attribute vec2 a_corner;

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_correctionRatio;

varying vec4 v_color;
varying vec2 v_uv;
varying vec2 v_disc;

const float bias = 255.0 / 254.0;

void main() {
  // The disc's radius in the framed graph's space, as sigma's own node programs have it.
  float radius = a_size * u_correctionRatio / u_sizeRatio * 2.0;
  vec2 position = a_position + a_corner * radius * a_scale;
  gl_Position = vec4((u_matrix * vec3(position, 1)).xy, 0, 1);
  // The atlas's rows run down, as the canvas's do; the graph's y runs up.
  v_uv = a_cell.xy + vec2(a_corner.x * 0.5 + 0.5, 0.5 - a_corner.y * 0.5) * a_cell.zw;
  // Where this corner is, in disc radii: inside 1 is the node.
  v_disc = a_corner * a_scale;
  #ifdef PICKING_MODE
  v_color = a_id;
  #else
  v_color = a_color;
  #endif
  v_color.a *= bias;
}
`;

// language=GLSL
const FRAGMENT = /* glsl */ `
precision mediump float;

varying vec4 v_color;
varying vec2 v_uv;
varying vec2 v_disc;

uniform sampler2D u_atlas;

void main(void) {
  #ifdef PICKING_MODE
  // A bullet is picked as far as its disc, as a disc is.
  if (length(v_disc) > 1.0) discard;
  gl_FragColor = v_color;
  #else
  // The atlas is uploaded premultiplied, as sigma blends; presence is the colour's alpha.
  gl_FragColor = texture2D(u_atlas, v_uv) * v_color.a;
  #endif
}
`;

const { FLOAT, UNSIGNED_BYTE, TRIANGLES } = WebGLRenderingContext;
const UNIFORMS = ["u_matrix", "u_sizeRatio", "u_correctionRatio", "u_atlas"] as const;
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

/** The sigma node program drawing each node as its bullet, from `atlas`. */
export function createBulletProgram(atlas: SigmaBulletAtlas) {
  return class BulletProgram extends NodeProgram<Uniform> {
    override drawLabel = drawGraphLabel;
    override drawHover = drawGraphHover;
    private texture: WebGLTexture | null = null;
    private uploaded = -1;

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
          { name: "a_cell", size: 4, type: FLOAT },
          { name: "a_scale", size: 1, type: FLOAT },
        ],
        CONSTANT_ATTRIBUTES: [{ name: "a_corner", size: 2, type: FLOAT }],
        CONSTANT_DATA: QUAD,
      };
    }

    processVisibleItem(nodeIndex: number, startIndex: number, data: NodeDisplayData): void {
      const { bulletCell, bulletScale } = data as NodeDisplayData & Partial<BulletAttributes>;
      const [x, y, w, h] = atlas.cell(bulletCell ?? 0);
      const array = this.array;
      let i = startIndex;
      array[i++] = data.x;
      array[i++] = data.y;
      array[i++] = data.size;
      array[i++] = floatColor(data.color);
      array[i++] = nodeIndex;
      array[i++] = x;
      array[i++] = y;
      array[i++] = w;
      array[i++] = h;
      array[i] = bulletScale ?? 1;
    }

    setUniforms(params: RenderParams, { gl, uniformLocations }: ProgramInfo<Uniform>): void {
      gl.uniform1f(uniformLocations.u_correctionRatio, params.correctionRatio);
      gl.uniform1f(uniformLocations.u_sizeRatio, params.sizeRatio);
      gl.uniformMatrix3fv(uniformLocations.u_matrix, false, params.matrix);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.bind(gl));
      gl.uniform1i(uniformLocations.u_atlas, 0);
    }

    /** This context's copy of the atlas, uploaded again when it has been repainted. */
    private bind(gl: WebGLRenderingContext | WebGL2RenderingContext): WebGLTexture | null {
      this.texture ??= gl.createTexture();
      if (this.uploaded === atlas.version) return this.texture;
      this.uploaded = atlas.version;
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      // A bullet is drawn far smaller than its cell: mipmaps where the context takes a
      // canvas of any size (WebGL 2), a plain linear filter where it does not.
      if (gl instanceof WebGL2RenderingContext) {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      return this.texture;
    }

    override kill(): void {
      if (this.texture !== null) this.normalProgram.gl.deleteTexture(this.texture);
      this.texture = null;
      super.kill();
    }
  };
}
