/**
 * The 3D canvas's items (`canvas-scene`): each one the box its shape fills,
 * built by the mesh builders (`canvas-scene-solids`), stood on its paint
 * plane (`paintPlanes`) and turned about its centre by the item's frame
 * (`boxFrame`), canvas y flipped into three's as for every point. A flat item is its footprint, faced with the card
 * painted as it looks in 2D (`canvas-card-face`) into a canvas texture, so
 * text stays text; its back is blank card stock. A solid carries that face
 * on its top and the body below it in the rig's matcap finish (shaded
 * without lights) tinted by its colour. Every item draws its edges as a
 * diagram does, so a flat item seen edge-on is a line rather than nothing.
 *
 * Ground cues make height legible: a raised item or a solid casts a soft
 * shadow of its footprint on the floor, and a selected raised item drops a
 * stem to the floor.
 *
 * A face is repainted only when what it shows changes (`faceVersion`). An
 * item whose size alone changes keeps its face stretched until the changes
 * pause, then is repainted once; so is every face painted before the page's
 * fonts arrived. Texture density follows the display's pixel ratio. A
 * geometry is rebuilt only when what it is built from changes (`solidKey`).
 */
import {
  BackSide,
  CanvasTexture,
  CircleGeometry,
  Color,
  FrontSide,
  Group,
  Line2NodeMaterial,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
  type Material,
  type MeshMatcapNodeMaterial,
  type Object3D,
  type UniformNode,
} from "three/webgpu";
import { LineSegments2 } from "three/addons/lines/webgpu/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { mix, texture, uniform } from "three/tsl";
import {
  CANVAS_SHAPES,
  boxFrame,
  boxToWorld,
  canvasDepth,
  faceShare,
  itemShape,
  paintOrder,
  shapeOutline,
  tracePath,
  type CanvasFootprint,
  type CanvasNode,
} from "@kb/canvas";
import { paintPlanes } from "./canvas-camera";
import { matcapMaterial, paletteMatcap } from "@/scene/gpu/rig";
import {
  cardFaceOf,
  cornerRadius,
  FACE_MARGIN,
  over,
  paintCardFace,
  type CardFace,
  type CardLook,
} from "./canvas-card-face";
import type { CanvasSceneContent } from "./canvas-scene-content";
import { BODY, FACE, solidGeometry, solidKey, type SolidSpec } from "./canvas-scene-solids";
import { matrixToThree } from "./canvas-scene-space";

/** A shadow lies just in front of the items on the floor. */
const SHADOW_Z = 0.15;
/** Texture pixels per canvas unit per display pixel, and the most a face may have. */
const DENSITY_PER_PIXEL = 1.5;
const MAX_DENSITY = 3;
const MAX_TEXTURE = 4096;
/** How long sizes must hold still before a stretched face is repainted, ms. */
const REPAINT_AFTER_MS = 180;
/** The shadow texture's silhouette, inset this share of its side on each edge. */
const SHADOW_INSET = 28 / 128;

/** Edge widths, CSS pixels: a hairline at rest, firmer when selected. */
const EDGE_WIDTH = 1;
const EDGE_WIDTH_SELECTED = 2;
/**
 * The matcap's light, as greys: the share of an item's colour each side of
 * it shows, brightest facing the upper left and falling off toward the rim.
 * Amounts of light, not colours, so they are the same in every theme.
 */
const MATCAP_LIGHT = {
  ground: "rgb(255, 255, 255)",
  edge: "rgb(255, 255, 255)",
  accent: "rgb(238, 238, 238)",
  hue: "rgb(196, 196, 196)",
  ink: "rgb(128, 128, 128)",
};

interface Item {
  readonly group: Group;
  readonly body: Mesh;
  readonly back: Mesh;
  readonly edges: LineSegments2;
  readonly groundShadow: Mesh;
  readonly stem: Group;
  readonly faces: { readonly flat: MeshBasicNodeMaterial; readonly solid: MeshBasicNodeMaterial };
  readonly bodyMaterial: MeshMatcapNodeMaterial;
  readonly edgeMaterial: Line2NodeMaterial;
  readonly cast: MeshBasicNodeMaterial;
  readonly stemMaterials: readonly (Line2NodeMaterial | MeshBasicNodeMaterial)[];
  readonly materials: readonly { dispose(): void }[];
  /** The face texture, as the materials sample it (its value swaps when the size does). */
  readonly face: ReturnType<typeof texture>;
  /** How dark this item's shadow is, 0–1. */
  readonly shade: UniformNode<"float", number>;
  map: CanvasTexture;
  /** What the face shows (`faceVersion`), and the size it was painted at. */
  version: string;
  painted: { width: number; height: number };
  /** What the geometry was built from (`solidKey`), and whether its edges wait for a selection. */
  built: string;
  edgesWhenSelected: boolean;
  item: CanvasNode;
  shows: { face: CardFace; selected: boolean };
}

/** A soft, blurred silhouette of a footprint, which every shadow of it is stretched from. */
function shadowTexture(footprint: CanvasFootprint): CanvasTexture {
  const size = 128;
  const inset = size * SHADOW_INSET;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    ctx.filter = "blur(14px)";
    // Only the silhouette's alpha is sampled; the shadow's colour is the material's.
    ctx.fillStyle = "rgb(0, 0, 0)";
    ctx.translate(inset, inset);
    ctx.beginPath();
    tracePath(ctx, shapeOutline(footprint, size - inset * 2, size - inset * 2, 12));
    ctx.fill();
  }
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  return map;
}

/** FNV-1a over a string: a cheap fingerprint of a face's text. */
function fingerprint(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** What a face shows, as a version: changes exactly when it must be repainted (size aside). */
function faceVersion(face: CardFace, selected: boolean): string {
  const mark = selected ? "s" : "-";
  switch (face.kind) {
    case "note":
      return `n${mark}${fingerprint(face.text)}${face.tags.map((t) => `|${t.name}:${t.color}`).join("")}`;
    case "shape":
      return `s${mark}${face.shape}:${face.color ?? ""}:${fingerprint(face.label)}`;
    case "text":
      return `t${mark}${fingerprint(face.text)}`;
    case "group":
    case "missing":
    case "other":
      return `${face.kind}${mark}${fingerprint(face.label)}`;
    default:
      return "";
  }
}

function faceDensity(width: number, height: number): number {
  const ratio = typeof window === "undefined" ? 1 : Math.max(1, window.devicePixelRatio || 1);
  return Math.min(MAX_DENSITY, ratio * DENSITY_PER_PIXEL, MAX_TEXTURE / Math.max(width, height));
}

/** The canvas each face texture was painted into. */
const FACE_CANVASES = new WeakMap<CanvasTexture, HTMLCanvasElement>();

function faceMap(canvas: HTMLCanvasElement): CanvasTexture {
  // GAP [[01M3S5DDC3JYX8871YMJ7C6PAN]]
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 8;
  FACE_CANVASES.set(map, canvas);
  return map;
}

/**
 * Paint `face` into `map`'s canvas when it has the size the item needs,
 * otherwise into a new texture (a GPU texture keeps the size it was made at).
 */
function paintFace(map: CanvasTexture, entry: Item, look: CardLook): CanvasTexture {
  const { item } = entry;
  const width = item.width + FACE_MARGIN * 2;
  const height = item.height + FACE_MARGIN * 2;
  const density = faceDensity(width, height);
  const pixelsW = Math.ceil(width * density);
  const pixelsH = Math.ceil(height * density);
  const old = FACE_CANVASES.get(map);
  const fits = old !== undefined && old.width === pixelsW && old.height === pixelsH;
  const canvas = fits ? old : document.createElement("canvas");
  canvas.width = pixelsW;
  canvas.height = pixelsH;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pixelsW, pixelsH);
    ctx.setTransform(density, 0, 0, density, FACE_MARGIN * density, FACE_MARGIN * density);
    const { face, selected } = entry.shows;
    paintCardFace(ctx, face, { width: item.width, height: item.height, selected }, look);
  }
  if (fits) {
    map.needsUpdate = true;
    return map;
  }
  return faceMap(canvas);
}

/** The colour an item names (a JSON Canvas preset or a literal), resolved; undefined for none. */
function colorOf(item: CanvasNode, look: CardLook): string | undefined {
  return item.color === undefined ? undefined : (look.presets[item.color] ?? item.color);
}

/** Where `points` (x, y, z each, in pairs) stand, as fat-line positions. */
function segments(points: readonly number[]): LineSegmentsGeometry {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(points.length > 0 ? [...points] : [0, 0, 0, 0, 0, 0]);
  return geometry;
}

/** An item's materials in the slots its geometry's groups name. */
function slotted(face: Material, body: Material): Material[] {
  const slots: Material[] = [];
  slots[FACE] = face;
  slots[BODY] = body;
  return slots;
}

export class ItemLayer {
  readonly root = new Group();
  private readonly items = new Map<string, Item>();
  private readonly plane = new PlaneGeometry(1, 1);
  private readonly foot = new CircleGeometry(3.2, 20);
  /** Each footprint's blurred silhouette, made once and shared by every shadow of it. */
  private readonly shadowMaps: { readonly [F in CanvasFootprint]: CanvasTexture } = {
    rect: shadowTexture("rect"),
    ellipse: shadowTexture("ellipse"),
    diamond: shadowTexture("diamond"),
  };
  private readonly matcap = paletteMatcap(MATCAP_LIGHT);
  private readonly shadowStrength = uniform(0.16);
  private readonly stock = uniform(new Color());
  private look: CardLook;
  private dark: boolean;
  private readonly stale = new Set<Item>();
  /** Scratch for an item's turn in three's world. */
  private readonly turn = new Matrix4();
  private repaint: ReturnType<typeof setTimeout> | null = null;
  private readonly wake: () => void;
  order: readonly string[] = [];

  constructor(look: CardLook, dark: boolean, wake: () => void) {
    this.look = look;
    this.dark = dark;
    this.wake = wake;
    this.setLook(look, dark);
    // Faces painted before the page's fonts arrived were set in a fallback face.
    const fonts = typeof document === "undefined" ? undefined : document.fonts;
    if (fonts !== undefined && fonts.status !== "loaded") {
      void fonts.ready.then(() => {
        for (const entry of this.items.values()) entry.version = "";
        this.repaintNow();
      });
    }
  }

  setLook(look: CardLook, dark: boolean): void {
    this.look = look;
    this.dark = dark;
    this.stock.value.set(look.face);
    this.shadowStrength.value = dark ? 0.8 : 0.17;
    for (const entry of this.items.values()) {
      entry.version = "";
      entry.built = "";
    }
  }

  sync(content: CanvasSceneContent): void {
    const items = paintOrder(content.doc.nodes);
    const seen = new Set<string>();
    for (const { item, z } of paintPlanes(items)) {
      seen.add(item.id);
      const selected = content.selection.nodeIds.has(item.id);
      const face = cardFaceOf(item, content.nodes);
      const version = faceVersion(face, selected);
      const entry = this.items.get(item.id) ?? this.add(item, { face, selected });
      entry.item = item;
      entry.shows = { face, selected };
      const resized = entry.painted.width !== item.width || entry.painted.height !== item.height;
      if (entry.version !== version) this.paint(entry, version);
      else if (resized) this.stale.add(entry);
      this.build(entry);
      this.place(entry, z, selected);
    }
    for (const [id, entry] of this.items) {
      if (seen.has(id)) continue;
      this.remove(entry);
      this.items.delete(id);
    }
    this.order = items.map((item) => item.id);
    if (this.stale.size > 0) this.repaintSoon();
  }

  /**
   * The canvas-space height item `id`'s base stands at, and its face's
   * corners in the world (the plane `faceShare` names, read through the
   * mesh's own placement).
   */
  drawn(id: string): { z: number; corners: Vector3[] } | null {
    const entry = this.items.get(id);
    if (entry === undefined) return null;
    entry.group.updateMatrixWorld(true);
    const { item } = entry;
    const { width, height } = item;
    const face = faceShare(item) * canvasDepth(item);
    const corners = [
      [-width / 2, height / 2],
      [width / 2, height / 2],
      [width / 2, -height / 2],
      [-width / 2, -height / 2],
    ].map(([x = 0, y = 0]) => entry.group.localToWorld(new Vector3(x, y, face)));
    return { z: entry.group.position.z, corners };
  }

  /**
   * The meshes item `id` is drawn as, in the world: what a ray through the
   * screen meets — its body, and a flat item's blank back, seen from behind.
   */
  bodiesOf(id: string): readonly Object3D[] {
    const entry = this.items.get(id);
    if (entry === undefined) return [];
    entry.group.updateMatrixWorld(true);
    return entry.back.visible ? [entry.body, entry.back] : [entry.body];
  }

  dispose(): void {
    if (this.repaint !== null) clearTimeout(this.repaint);
    for (const entry of this.items.values()) this.remove(entry);
    this.items.clear();
    this.plane.dispose();
    this.foot.dispose();
    this.matcap.dispose();
    for (const map of Object.values(this.shadowMaps)) map.dispose();
  }

  private paint(entry: Item, version: string): void {
    const map = paintFace(entry.map, entry, this.look);
    if (map !== entry.map) {
      entry.map.dispose();
      entry.map = map;
      entry.face.value = map;
    }
    entry.version = version;
    entry.painted = { width: entry.item.width, height: entry.item.height };
    this.stale.delete(entry);
  }

  private repaintSoon(): void {
    if (this.repaint !== null) clearTimeout(this.repaint);
    this.repaint = setTimeout(() => this.repaintNow(), REPAINT_AFTER_MS);
  }

  private repaintNow(): void {
    this.repaint = null;
    for (const entry of this.items.values()) {
      if (entry.version === "" || this.stale.has(entry)) {
        this.paint(entry, faceVersion(entry.shows.face, entry.shows.selected));
      }
    }
    this.wake();
  }

  /** Rebuild the item's geometry and edges when what they are built from has changed. */
  private build(entry: Item): void {
    const { item } = entry;
    const spec: SolidSpec = {
      shape: itemShape(item),
      width: item.width,
      height: item.height,
      depth: canvasDepth(item),
      radius: cornerRadius(item, this.look),
      faceMargin: FACE_MARGIN,
    };
    const key = solidKey(spec);
    if (entry.built === key) return;
    const solid = solidGeometry(spec);
    entry.body.geometry.dispose();
    entry.body.geometry = solid.geometry;
    entry.back.geometry = solid.geometry;
    entry.edges.geometry.dispose();
    entry.edges.geometry = segments(solid.edges);
    entry.edgesWhenSelected = solid.edgesWhenSelected;
    const raised = spec.depth > 0;
    entry.body.material = slotted(
      raised ? entry.faces.solid : entry.faces.flat,
      entry.bodyMaterial,
    );
    // Seen from below, a flat card is blank stock; a solid has its own bottom.
    entry.back.visible = !raised;
    const silhouette = this.shadowMaps[CANVAS_SHAPES[spec.shape].footprint];
    entry.cast.opacityNode = texture(silhouette).a.mul(this.shadowStrength).mul(entry.shade);
    entry.cast.needsUpdate = true;
    entry.built = key;
  }

  private add(item: CanvasNode, shows: Item["shows"]): Item {
    const map = faceMap(document.createElement("canvas"));
    const face = texture(map);
    const shade = uniform(1);
    const flat = new MeshBasicNodeMaterial({ transparent: true, alphaTest: 0.01, side: FrontSide });
    // The face's own alpha is the card's: an opacity node would multiply it in twice.
    flat.colorNode = face;
    // On a solid the face is laid over its stock: the top is opaque, like the rest of it.
    const solid = new MeshBasicNodeMaterial({ side: FrontSide });
    solid.colorNode = mix(this.stock, face.rgb, face.a);
    const bodyMaterial = matcapMaterial(this.matcap);
    // From behind, a flat card is blank stock in its own silhouette.
    const backMaterial = new MeshBasicNodeMaterial({
      transparent: true,
      alphaTest: 0.01,
      side: BackSide,
    });
    backMaterial.colorNode = this.stock;
    backMaterial.opacityNode = face.a.mul(0.94);
    const cast = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    cast.color.setRGB(0, 0, 0);
    const edgeMaterial = new Line2NodeMaterial({ color: 0, linewidth: EDGE_WIDTH });
    const stemMaterial = new Line2NodeMaterial({ color: 0, linewidth: EDGE_WIDTH, opacity: 0.6 });
    stemMaterial.transparent = true;
    const footMaterial = new MeshBasicNodeMaterial({ transparent: true, opacity: 0.7 });
    const placeholder = segments([]);
    const body = new Mesh(this.plane, slotted(flat, bodyMaterial));
    const back = new Mesh(this.plane, backMaterial);
    const edges = new LineSegments2(placeholder, edgeMaterial);
    const group = new Group();
    group.add(body, back, edges);
    const groundShadow = new Mesh(this.plane, cast);
    // After the items: a shadow darkens a card on the floor below it, and a raised item hides it.
    groundShadow.renderOrder = 1;
    const stem = new Group();
    stem.add(new LineSegments2(segments([0, 0, 0, 0, 0, 1]), stemMaterial));
    stem.add(new Mesh(this.foot, footMaterial));
    stem.visible = false;
    this.root.add(group, groundShadow, stem);
    const entry: Item = {
      group,
      body,
      back,
      edges,
      groundShadow,
      stem,
      faces: { flat, solid },
      bodyMaterial,
      edgeMaterial,
      cast,
      stemMaterials: [stemMaterial, footMaterial],
      materials: [
        flat,
        solid,
        bodyMaterial,
        backMaterial,
        cast,
        edgeMaterial,
        stemMaterial,
        footMaterial,
      ],
      face,
      shade,
      map,
      version: "",
      painted: { width: -1, height: -1 },
      built: "",
      edgesWhenSelected: false,
      item,
      shows,
    };
    // The shared plane stands in until the first build; never dispose it with the item.
    body.geometry = new PlaneGeometry(1, 1);
    this.items.set(item.id, entry);
    return entry;
  }

  /** Stand the item on its plane at `z`, colour it, and lay its shadow and stem on the floor. */
  private place(entry: Item, z: number, selected: boolean): void {
    const { item } = entry;
    const { look } = this;
    const cx = item.x + item.width / 2;
    const cy = item.y + item.height / 2;
    const depth = canvasDepth(item);
    // The geometry's origin is the centre of its base, in the box's own frame.
    const frame = boxFrame(item, z);
    const origin = boxToWorld(frame, { x: 0, y: 0, z: -frame.half.z });
    entry.group.position.set(origin.x, -origin.y, origin.z);
    entry.group.quaternion.setFromRotationMatrix(matrixToThree(frame.matrix, this.turn));
    const tint = colorOf(item, look);
    // The body: the card stock, or its colour laid over it, a little firmer in the dark.
    entry.bodyMaterial.color.set(
      tint === undefined
        ? this.dark
          ? over(look, look.ink, 0.12)
          : look.face
        : over(look, tint, this.dark ? 0.42 : 0.3),
    );
    entry.edgeMaterial.color.set(
      selected
        ? look.primary
        : tint === undefined
          ? over(look, look.ink, 0.28)
          : over(look, tint, 0.75),
    );
    entry.edgeMaterial.linewidth = selected ? EDGE_WIDTH_SELECTED : EDGE_WIDTH;
    entry.edges.visible = selected || !entry.edgesWhenSelected;
    // A raised item or a solid casts its footprint on the floor below: larger and fainter the
    // higher; a turned one casts its footprint as seen from above (its own axes, flattened).
    const lift = Math.max(0, origin.z);
    entry.groundShadow.visible = lift > 0.5 || depth > 0;
    const spread = 1 + Math.min(0.6, lift / 800);
    const reach = (1 / (1 - SHADOW_INSET * 2)) * (depth > 0 ? 1.04 : 0.8) * spread;
    const [a, b, , d, e] = frame.matrix;
    const [sx, sy] = [item.width * reach, item.height * reach];
    entry.groundShadow.matrixAutoUpdate = false;
    entry.groundShadow.matrix.set(
      a * sx,
      -b * sy,
      0,
      cx,
      -d * sx,
      e * sy,
      0,
      -(cy + lift * 0.1 + depth * 0.05),
      0,
      0,
      1,
      SHADOW_Z,
      0,
      0,
      0,
      1,
    );
    entry.shade.value = Math.exp(-lift / 1600) * (depth > 0 ? 0.9 : 1);
    // A selected raised item drops a stem from its base to the floor.
    entry.stem.visible = selected && lift > 0.5;
    if (entry.stem.visible) {
      entry.stem.position.set(origin.x, -origin.y, 0);
      const [line, foot] = entry.stem.children;
      if (line !== undefined) line.scale.set(1, 1, lift);
      if (foot !== undefined) foot.position.z = SHADOW_Z * 2;
      for (const material of entry.stemMaterials) material.color.set(look.primary);
    }
  }

  private remove(entry: Item): void {
    this.root.remove(entry.group, entry.groundShadow, entry.stem);
    for (const material of entry.materials) material.dispose();
    entry.body.geometry.dispose();
    entry.edges.geometry.dispose();
    for (const child of entry.stem.children) {
      if (child instanceof LineSegments2) child.geometry.dispose();
    }
    entry.map.dispose();
    this.stale.delete(entry);
  }
}
