/**
 * The 3D canvas: the canvas document drawn in depth on the scene kit's stage
 * (`@/scene/gpu/stage`), through the one camera model (DESIGN-UI.md → Canvas
 * → Projections). This module is the only part of the canvas that touches
 * three, and loads only inside `canvas-3d-stage`'s lazy chunk.
 *
 * - **Cards** are flat planes at their depth, each faced with the card
 *   painted as it looks in 2D (`canvas-card-face`) into a canvas texture, so
 *   text stays text. Their backs are blank card stock. A raised card casts a
 *   soft shadow on the canvas plane, which is what makes depth legible.
 * - **Edges** are lines between the items' side anchors, bowed like their 2D
 *   bezier and climbing from one depth to the other, with a cone for an
 *   arrowhead.
 * - **The canvas plane** carries the 2D dot grid, fading out with distance.
 * - **The camera** is the rig's view (`lib/canvas-camera-rig`), stepped and
 *   applied every frame; canvas space (y down) maps to three's (y up) by
 *   flipping y, for points and camera alike.
 *
 * Unlit, untoned and unbloomed: a card's colours are the tokens'.
 */
import {
  BackSide,
  CanvasTexture,
  Color,
  ConeGeometry,
  FrontSide,
  Group,
  Line2NodeMaterial,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type PerspectiveCamera,
} from "three/webgpu";
import {
  float,
  fract,
  fwidth,
  length,
  positionWorld,
  smoothstep,
  texture,
  uniform,
} from "three/tsl";
import { Line2 } from "three/addons/lines/webgpu/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import {
  canvasDepth,
  paintOrder,
  type CanvasDoc,
  type CanvasEdge,
  type CanvasNode,
  type CanvasSide,
} from "@kb/canvas";
import { mountScene, type SceneStage } from "@/scene/gpu/stage";
import { toScreen, type ScreenPoint } from "@/scene/gpu/screen";
import type { SceneBackend } from "@/scene/backend";
import type { SceneHandle } from "@/scene/host";
import type { ScenePalette } from "@/scene/palette";
import { cameraPose, type CanvasView, type ViewSize } from "@/lib/canvas-camera";
import type { CanvasCameraRig } from "@/lib/canvas-camera-rig";
import { sidePoint } from "@/lib/canvas-edge-path";
import type { CanvasSelection } from "@/lib/canvas-selection";
import { readTokenColor } from "@/lib/css-color";
import type { Timing } from "@/lib/timing";
import type { OutlineNode } from "@/lib/types";
import {
  cardFaceOf,
  FACE_MARGIN,
  over,
  paintCardFace,
  type CardFace,
  type CardLook,
} from "./canvas-card-face";

/** What the scene draws: the document, the store its cards read, and the shared selection. */
interface CanvasSceneContent {
  readonly doc: CanvasDoc;
  readonly nodes: ReadonlyMap<string, OutlineNode>;
  readonly selection: CanvasSelection;
}

export interface CanvasSceneInit {
  readonly rig: CanvasCameraRig;
  readonly content: CanvasSceneContent;
  readonly look: CardLook;
  readonly palette: ScenePalette;
  readonly dark: boolean;
  readonly timing: Timing;
  readonly reducedMotion: boolean;
}

/** What a render spec and the projection contract read back from a mounted scene. */
interface CanvasSceneInspection {
  readonly backend: SceneBackend;
  readonly frames: number;
  /** Item ids drawn, back to front. */
  readonly items: readonly string[];
  /** Edge ids drawn. */
  readonly edges: readonly string[];
  /** Item and edge ids drawn as selected. */
  readonly selected: readonly string[];
  /** Where an item's centre is on the canvas, CSS pixels; null when out of view. */
  screenOf(id: string): { x: number; y: number } | null;
  /** The card three's own ray hits at a canvas point: the drawn geometry, not the model. */
  pick(screen: { x: number; y: number }): string | null;
}

export interface CanvasScene extends SceneHandle {
  setContent(content: CanvasSceneContent): void;
  setLook(look: CardLook, palette: ScenePalette, dark: boolean): void;
  inspect(): CanvasSceneInspection;
}

/** A field of view the renderer can hold: the orthographic end of a dolly is this, not 0. */
const MIN_FOV = 0.5;
/** Cards at one depth are drawn this far apart in paint order, canvas units. */
const ORDER_STEP = 0.08;
/** The canvas plane sits just behind the cards that lie on it. */
const PLANE_Z = -1;
/** A shadow lies just in front of the cards on the plane. */
const SHADOW_Z = 0.15;
/** The 2D dot grid's pitch and dot radius, canvas units. */
const GRID_STEP = 20;
const GRID_DOT = 1.1;
/** Texture pixels per canvas unit: sharp at 1:1 on a 2× display and a little beyond. */
const FACE_DENSITY = 3;
const MAX_TEXTURE = 4096;

const flip = (p: { x: number; y: number; z: number }, out: Vector3) => out.set(p.x, -p.y, p.z);

// --- the camera --------------------------------------------------------------

/** Aim three's camera at `view`, for a canvas of `size`. */
function applyView(camera: PerspectiveCamera, view: CanvasView, size: ViewSize, eye: Vector3) {
  const held = { ...view, fov: Math.max(MIN_FOV, view.fov) };
  const pose = cameraPose(held, size);
  camera.fov = held.fov;
  camera.aspect = size.width / Math.max(1, size.height);
  flip(pose.eye, camera.position);
  flip(pose.up, camera.up);
  camera.lookAt(flip(pose.target, eye));
  const distance = camera.position.distanceTo(eye);
  camera.near = Math.max(1, distance * 0.02);
  camera.far = distance * 8 + 40_000;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return distance;
}

// --- cards -------------------------------------------------------------------

interface Card {
  readonly group: Group;
  readonly front: Mesh;
  /** Its shadow on the canvas plane. */
  readonly footprint: Mesh;
  readonly materials: readonly MeshBasicNodeMaterial[];
  /** The face texture, as the materials sample it (its value swaps when the size does). */
  readonly face: ReturnType<typeof texture>;
  /** How dark this card's shadow is, 0–1. */
  readonly shade: ReturnType<typeof uniform<number>>;
  map: CanvasTexture;
  key: string;
  item: CanvasNode;
}

/** A soft, blurred card silhouette every raised card's shadow is stretched from. */
function shadowTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    ctx.filter = "blur(14px)";
    // Only the silhouette's alpha is sampled; the shadow's colour is the material's.
    ctx.fillStyle = readTokenColor("--foreground");
    ctx.beginPath();
    ctx.roundRect(28, 28, size - 56, size - 56, 12);
    ctx.fill();
  }
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  return map;
}

/**
 * Paint `face` into `map`'s canvas when it has the size the card needs,
 * otherwise into a new texture (a GPU texture keeps the size it was made at).
 */
/** The canvas each face texture was painted into. */
const FACE_CANVASES = new WeakMap<CanvasTexture, HTMLCanvasElement>();

function faceMap(canvas: HTMLCanvasElement): CanvasTexture {
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 8;
  FACE_CANVASES.set(map, canvas);
  return map;
}

function paintFace(
  map: CanvasTexture,
  face: CardFace,
  item: CanvasNode,
  selected: boolean,
  look: CardLook,
): CanvasTexture {
  const width = item.width + FACE_MARGIN * 2;
  const height = item.height + FACE_MARGIN * 2;
  const density = Math.min(FACE_DENSITY, MAX_TEXTURE / Math.max(width, height));
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
    paintCardFace(ctx, face, { width: item.width, height: item.height, selected }, look);
  }
  if (fits) {
    map.needsUpdate = true;
    return map;
  }
  return faceMap(canvas);
}

class CardLayer {
  readonly root = new Group();
  private readonly cards = new Map<string, Card>();
  private readonly plane = new PlaneGeometry(1, 1);
  private readonly shadowMap = shadowTexture();
  private readonly shadowStrength = uniform(0.16);
  private readonly stock = uniform(new Color());
  order: readonly string[] = [];

  setLook(look: CardLook, dark: boolean): void {
    this.stock.value.set(look.face);
    this.shadowStrength.value = dark ? 0.8 : 0.17;
    for (const card of this.cards.values()) card.key = "";
  }

  sync(content: CanvasSceneContent, look: CardLook): void {
    const items = paintOrder(content.doc.nodes);
    const seen = new Set<string>();
    let tier = 0;
    items.forEach((item, index) => {
      seen.add(item.id);
      // Cards at one depth stand a hair apart in paint order, so they never fight.
      const previous = items[index - 1];
      tier = previous !== undefined && canvasDepth(previous) === canvasDepth(item) ? tier + 1 : 0;
      const selected = content.selection.nodeIds.has(item.id);
      const face = cardFaceOf(item, content.nodes);
      const key = JSON.stringify([face, item.width, item.height, selected]);
      const card = this.cards.get(item.id) ?? this.add(item);
      if (card.key !== key) {
        const map = paintFace(card.map, face, item, selected, look);
        if (map !== card.map) {
          card.map.dispose();
          card.map = map;
          card.face.value = map;
        }
        card.key = key;
      }
      card.item = item;
      this.place(card, item, tier);
    });
    for (const [id, card] of this.cards) {
      if (seen.has(id)) continue;
      this.remove(card);
      this.cards.delete(id);
    }
    this.order = items.map((item) => item.id);
  }

  private add(item: CanvasNode): Card {
    const map = faceMap(document.createElement("canvas"));
    const face = texture(map);
    const shade = uniform(1);
    const front = new MeshBasicNodeMaterial({
      transparent: true,
      alphaTest: 0.01,
      side: FrontSide,
    });
    // The face's own alpha is the card's: an opacity node would multiply it in twice.
    front.colorNode = face;
    // From behind, a card is blank stock in its own silhouette.
    const back = new MeshBasicNodeMaterial({ transparent: true, alphaTest: 0.01, side: BackSide });
    back.colorNode = this.stock;
    back.opacityNode = face.a.mul(0.94);
    const cast = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    cast.color.setRGB(0, 0, 0);
    cast.opacityNode = texture(this.shadowMap).a.mul(this.shadowStrength).mul(shade);
    const frontMesh = new Mesh(this.plane, front);
    frontMesh.userData.cardId = item.id;
    const group = new Group();
    group.add(frontMesh, new Mesh(this.plane, back));
    const footprint = new Mesh(this.plane, cast);
    // After the cards: a shadow darkens a card on the plane below it, and a raised card hides it.
    footprint.renderOrder = 1;
    this.root.add(group, footprint);
    const card: Card = {
      group,
      front: frontMesh,
      footprint,
      materials: [front, back, cast],
      face,
      shade,
      map,
      key: "",
      item,
    };
    this.cards.set(item.id, card);
    return card;
  }

  private place(card: Card, item: CanvasNode, tier: number): void {
    const z = canvasDepth(item);
    const cx = item.x + item.width / 2;
    const cy = item.y + item.height / 2;
    card.group.position.set(cx, -cy, z + tier * ORDER_STEP);
    card.group.scale.set(item.width + FACE_MARGIN * 2, item.height + FACE_MARGIN * 2, 1);
    // A raised card's shadow falls on the plane below it, larger and fainter the higher it is.
    const lift = Math.max(0, z);
    card.footprint.visible = lift > 0.5;
    const spread = 1 + Math.min(0.6, lift / 800);
    card.footprint.position.set(cx, -(cy + lift * 0.1), SHADOW_Z);
    card.footprint.scale.set(item.width * spread * 1.38, item.height * spread * 1.5, 1);
    card.shade.value = Math.exp(-lift / 1600);
  }

  private remove(card: Card): void {
    this.root.remove(card.group, card.footprint);
    for (const material of card.materials) material.dispose();
    card.map.dispose();
  }

  /** Each card's front, for three's own ray. */
  fronts(): Mesh[] {
    return [...this.cards.values()].map((card) => card.front);
  }

  item(id: string): CanvasNode | undefined {
    return this.cards.get(id)?.item;
  }

  dispose(): void {
    for (const card of this.cards.values()) this.remove(card);
    this.cards.clear();
    this.plane.dispose();
    this.shadowMap.dispose();
  }
}

// --- edges -------------------------------------------------------------------

const SAMPLES = 28;

/** A side's outward direction in canvas space. */
function outward(side: CanvasSide): [number, number] {
  if (side === "left") return [-1, 0];
  if (side === "top") return [0, -1];
  if (side === "bottom") return [0, 1];
  return [1, 0];
}

/** The edge's curve in canvas space: the 2D bezier, climbing smoothly between the two depths. */
function edgeCurve(from: CanvasNode, to: CanvasNode, edge: CanvasEdge): Vector3[] {
  const fromSide = edge.fromSide ?? "right";
  const toSide = edge.toSide ?? "left";
  const a = sidePoint(from, fromSide);
  const b = sidePoint(to, toSide);
  const za = canvasDepth(from);
  const zb = canvasDepth(to);
  const reach = Math.max(40, Math.hypot(b.x - a.x, b.y - a.y) * 0.4);
  const [ax, ay] = outward(fromSide);
  const [bx, by] = outward(toSide);
  const c1 = { x: a.x + ax * reach, y: a.y + ay * reach };
  const c2 = { x: b.x + bx * reach, y: b.y + by * reach };
  const points: Vector3[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const u = 1 - t;
    const x = u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x;
    const y = u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y;
    const z = za + (zb - za) * t * t * (3 - 2 * t);
    points.push(new Vector3(x, -y, z + 0.5));
  }
  return points;
}

const UP = new Vector3(0, 1, 0);

class EdgeLayer {
  readonly root = new Group();
  private readonly cone = new ConeGeometry(4.2, 11, 18);
  ids: readonly string[] = [];

  sync(content: CanvasSceneContent, look: CardLook): void {
    this.clear();
    const byId = new Map(content.doc.nodes.map((n) => [n.id, n]));
    const rest = new Color(look.face).lerp(new Color(look.ink), 0.4);
    const ids: string[] = [];
    for (const edge of content.doc.edges) {
      const from = byId.get(edge.fromNode);
      const to = byId.get(edge.toNode);
      if (!from || !to) continue;
      const selected = content.selection.edgeIds.has(edge.id);
      const preset =
        edge.color === undefined ? undefined : (look.presets[edge.color] ?? edge.color);
      const color = selected
        ? new Color(look.primary)
        : preset === undefined
          ? rest
          : new Color(preset);
      const points = edgeCurve(from, to, edge);
      const geometry = new LineGeometry();
      geometry.setPositions(points.flatMap((p) => [p.x, p.y, p.z]));
      const material = new Line2NodeMaterial({ color, linewidth: selected ? 2.4 : 1.6 });
      const line = new Line2(geometry, material);
      line.userData.edgeId = edge.id;
      this.root.add(line);
      if (edge.toEnd !== "none") this.arrow(points, color, false);
      if (edge.fromEnd === "arrow") this.arrow(points, color, true);
      ids.push(edge.id);
    }
    this.ids = ids;
  }

  private arrow(points: readonly Vector3[], color: Color, atStart: boolean): void {
    const tip = atStart ? points[0] : points.at(-1);
    const before = atStart ? points[1] : points.at(-2);
    if (tip === undefined || before === undefined) return;
    const dir = tip.clone().sub(before).normalize();
    const head = new Mesh(this.cone, new MeshBasicNodeMaterial({ color }));
    head.quaternion.copy(new Quaternion().setFromUnitVectors(UP, dir));
    head.position.copy(tip).addScaledVector(dir, -5.5);
    this.root.add(head);
  }

  private clear(): void {
    for (const child of this.root.children) {
      if (child instanceof Line2) {
        child.geometry.dispose();
        child.material.dispose();
      } else if (child instanceof Mesh && child.material instanceof MeshBasicNodeMaterial) {
        child.material.dispose();
      }
    }
    this.root.clear();
  }

  dispose(): void {
    this.clear();
    this.cone.dispose();
  }
}

// --- the canvas plane ----------------------------------------------------------

/** The 2D dot grid on the canvas plane, fading out around the focus. */
function canvasPlane() {
  const focus = uniform(new Vector2());
  const reach = uniform(1200);
  const ink = uniform(new Color());
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const at = positionWorld.xy;
  const cell = length(fract(at.div(GRID_STEP)).sub(0.5)).mul(GRID_STEP);
  const aa = fwidth(cell).max(0.02);
  const dot = float(1).sub(smoothstep(float(GRID_DOT).sub(aa), float(GRID_DOT).add(aa), cell));
  // Where a dot shrinks below a pixel the grid would turn to haze; it fades out instead.
  const legible = float(1).sub(smoothstep(0.5, 1.4, aa.div(GRID_DOT)));
  const fade = float(1).sub(smoothstep(reach.mul(0.35), reach, length(at.sub(focus))));
  material.colorNode = ink;
  material.opacityNode = dot.mul(legible).mul(fade);
  const mesh = new Mesh(new PlaneGeometry(200_000, 200_000), material);
  mesh.position.z = PLANE_Z;
  mesh.renderOrder = -2;
  return {
    mesh,
    /** The dots' colour: the 2D grid's, already composited over the ground. */
    setLook: (look: CardLook) => {
      ink.value.set(over(look, look.ink, 0.09));
    },
    follow: (view: CanvasView, size: ViewSize) => {
      focus.value.set(view.x, -view.y);
      reach.value = (Math.max(size.width, size.height) / view.zoom) * 1.1;
    },
  };
}

// --- the scene -----------------------------------------------------------------

export async function mountCanvasScene(
  host: HTMLElement,
  init: CanvasSceneInit,
): Promise<CanvasScene> {
  const { parts, handle } = await mountScene(
    host,
    {
      fov: 34,
      palette: init.palette,
      timing: init.timing,
      reducedMotion: init.reducedMotion,
      bloom: { strength: 0, radius: 0.4 },
      vignette: 0.18,
    },
    (stage) => canvasScene(stage, init),
  );
  return { ...handle, ...parts.api };
}

function canvasScene(stage: SceneStage, init: CanvasSceneInit) {
  const { camera, scene } = stage;
  const canvas = stage.renderer.domElement;
  stage.setToneMapping("none");
  stage.backdrop({});
  const fog = stage.atmosphere(4000, 16_000);
  const cards = new CardLayer();
  const edges = new EdgeLayer();
  const plane = canvasPlane();
  plane.setLook(init.look);
  scene.add(plane.mesh, edges.root, cards.root);
  let look = init.look;
  let content = init.content;
  cards.setLook(look, init.dark);
  cards.sync(content, look);
  edges.sync(content, look);
  const { rig } = init;
  rig.wake = stage.invalidate;
  // The stage steps every frame by 0 under reduced motion; a flight must land instead.
  rig.setReducedMotion(init.reducedMotion);
  const viewport = { width: 1, height: 1 };
  const eye = new Vector3();

  const frame = (dt: number) => {
    const moving = rig.step(dt);
    viewport.width = canvas.clientWidth || viewport.width;
    viewport.height = canvas.clientHeight || viewport.height;
    const distance = applyView(camera, rig.view, viewport, eye);
    fog.near.value = distance * 1.25;
    fog.far.value = distance * 4.5;
    plane.follow(rig.view, viewport);
    return moving;
  };

  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const hitPoint = new Vector3();

  const api = {
    setContent: (next: CanvasSceneContent) => {
      content = next;
      cards.sync(content, look);
      edges.sync(content, look);
      stage.invalidate();
    },
    setLook: (next: CardLook, palette: ScenePalette, dark: boolean) => {
      look = next;
      stage.setPalette(palette);
      plane.setLook(look);
      cards.setLook(look, dark);
      cards.sync(content, look);
      edges.sync(content, look);
      stage.invalidate();
    },
    inspect: (): CanvasSceneInspection => ({
      backend: stage.backend,
      frames: stage.frames(),
      items: cards.order,
      edges: edges.ids,
      selected: [
        ...cards.order.filter((id) => content.selection.nodeIds.has(id)),
        ...edges.ids.filter((id) => content.selection.edgeIds.has(id)),
      ],
      screenOf: (id) => {
        const item = cards.item(id);
        if (item === undefined) return null;
        const world = {
          x: item.x + item.width / 2,
          y: -(item.y + item.height / 2),
          z: canvasDepth(item),
        };
        const at: ScreenPoint = { x: 0, y: 0, depth: 0 };
        return toScreen(world, camera, viewport, at) ? { x: at.x, y: at.y } : null;
      },
      pick: (screen) => {
        ndc.set((screen.x / viewport.width) * 2 - 1, 1 - (screen.y / viewport.height) * 2);
        // Content set since the last frame has not been placed in the world yet.
        scene.updateMatrixWorld();
        raycaster.setFromCamera(ndc, camera);
        for (const hit of raycaster.intersectObjects(cards.fronts(), false)) {
          const id = hit.object.userData.cardId;
          const item = typeof id === "string" ? cards.item(id) : undefined;
          if (item === undefined) continue;
          hitPoint.copy(hit.point);
          const x = hitPoint.x;
          const y = -hitPoint.y;
          if (x >= item.x && x <= item.x + item.width && y >= item.y && y <= item.y + item.height)
            return item.id;
        }
        return null;
      },
    }),
  };

  return {
    api,
    frame,
    resize: (width: number, height: number) => {
      viewport.width = width;
      viewport.height = height;
      // The stage drew for its new size already; the camera's aim depends on it too.
      stage.invalidate();
    },
    setReducedMotion: (reduced: boolean) => rig.setReducedMotion(reduced),
    dispose: () => {
      rig.wake = () => {};
      edges.dispose();
      cards.dispose();
    },
  };
}
