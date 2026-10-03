/**
 * The 3D canvas's cards (`canvas-scene`): flat planes on their paint planes
 * (`paintPlanes`), each faced with the card painted as it looks in 2D
 * (`canvas-card-face`) into a canvas texture, so text stays text. Their
 * backs are blank card stock. A raised card casts a soft shadow on the canvas
 * plane, which is what makes depth legible.
 *
 * A face is repainted only when what it shows changes (`faceVersion`). A
 * card whose size alone changes keeps its face stretched until the changes
 * pause, then is repainted once; so is every face painted before the page's
 * fonts arrived. Texture density follows the display's pixel ratio.
 */
import {
  BackSide,
  CanvasTexture,
  Color,
  FrontSide,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
  type UniformNode,
} from "three/webgpu";
import { texture, uniform } from "three/tsl";
import { canvasDepth, paintOrder, type CanvasNode } from "@kb/canvas";
import { paintPlanes } from "@/lib/canvas-camera";
import { readTokenColor } from "@/lib/css-color";
import {
  cardFaceOf,
  FACE_MARGIN,
  paintCardFace,
  type CardFace,
  type CardLook,
} from "./canvas-card-face";
import type { CanvasSceneContent } from "./canvas-scene-content";

/** A shadow lies just in front of the cards on the plane. */
const SHADOW_Z = 0.15;
/** Texture pixels per canvas unit per display pixel, and the most a face may have. */
const DENSITY_PER_PIXEL = 1.5;
const MAX_DENSITY = 3;
const MAX_TEXTURE = 4096;
/** How long sizes must hold still before a stretched face is repainted, ms. */
const REPAINT_AFTER_MS = 180;

interface Card {
  readonly group: Group;
  readonly footprint: Mesh;
  readonly materials: readonly MeshBasicNodeMaterial[];
  /** The face texture, as the materials sample it (its value swaps when the size does). */
  readonly face: ReturnType<typeof texture>;
  /** How dark this card's shadow is, 0–1. */
  readonly shade: UniformNode<"float", number>;
  map: CanvasTexture;
  /** What the face shows (`faceVersion`), and the size it was painted at. */
  version: string;
  painted: { width: number; height: number };
  item: CanvasNode;
  shows: { face: CardFace; selected: boolean };
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
 * Paint `face` into `map`'s canvas when it has the size the card needs,
 * otherwise into a new texture (a GPU texture keeps the size it was made at).
 */
function paintFace(map: CanvasTexture, card: Card, look: CardLook): CanvasTexture {
  const { item } = card;
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
    const { face, selected } = card.shows;
    paintCardFace(ctx, face, { width: item.width, height: item.height, selected }, look);
  }
  if (fits) {
    map.needsUpdate = true;
    return map;
  }
  return faceMap(canvas);
}

export class CardLayer {
  readonly root = new Group();
  private readonly cards = new Map<string, Card>();
  private readonly plane = new PlaneGeometry(1, 1);
  private readonly shadowMap = shadowTexture();
  private readonly shadowStrength = uniform(0.16);
  private readonly stock = uniform(new Color());
  private look: CardLook;
  private readonly stale = new Set<Card>();
  private repaint: ReturnType<typeof setTimeout> | null = null;
  private readonly wake: () => void;
  order: readonly string[] = [];

  constructor(look: CardLook, dark: boolean, wake: () => void) {
    this.look = look;
    this.wake = wake;
    this.setLook(look, dark);
    // Faces painted before the page's fonts arrived were set in a fallback face.
    const fonts = typeof document === "undefined" ? undefined : document.fonts;
    if (fonts !== undefined && fonts.status !== "loaded") {
      void fonts.ready.then(() => {
        for (const card of this.cards.values()) card.version = "";
        this.repaintNow();
      });
    }
  }

  setLook(look: CardLook, dark: boolean): void {
    this.look = look;
    this.stock.value.set(look.face);
    this.shadowStrength.value = dark ? 0.8 : 0.17;
    for (const card of this.cards.values()) card.version = "";
  }

  sync(content: CanvasSceneContent): void {
    const items = paintOrder(content.doc.nodes);
    const seen = new Set<string>();
    for (const { item, z } of paintPlanes(items)) {
      seen.add(item.id);
      const selected = content.selection.nodeIds.has(item.id);
      const face = cardFaceOf(item, content.nodes);
      const version = faceVersion(face, selected);
      const card = this.cards.get(item.id) ?? this.add(item, { face, selected });
      card.item = item;
      card.shows = { face, selected };
      const resized = card.painted.width !== item.width || card.painted.height !== item.height;
      if (card.version !== version) this.paint(card, version);
      else if (resized) this.stale.add(card);
      this.place(card, z);
    }
    for (const [id, card] of this.cards) {
      if (seen.has(id)) continue;
      this.remove(card);
      this.cards.delete(id);
    }
    this.order = items.map((item) => item.id);
    if (this.stale.size > 0) this.repaintSoon();
  }

  /** The canvas-space depth card `id` is drawn at, and its rectangle's corners in the world. */
  drawn(id: string): { z: number; corners: Vector3[] } | null {
    const card = this.cards.get(id);
    if (card === undefined) return null;
    card.group.updateMatrixWorld(true);
    const { width, height } = card.item;
    const u = width / 2 / (width + FACE_MARGIN * 2);
    const v = height / 2 / (height + FACE_MARGIN * 2);
    const corners = [
      [-u, v],
      [u, v],
      [u, -v],
      [-u, -v],
    ].map(([x = 0, y = 0]) => card.group.localToWorld(new Vector3(x, y, 0)));
    return { z: card.group.position.z, corners };
  }

  dispose(): void {
    if (this.repaint !== null) clearTimeout(this.repaint);
    for (const card of this.cards.values()) this.remove(card);
    this.cards.clear();
    this.plane.dispose();
    this.shadowMap.dispose();
  }

  private paint(card: Card, version: string): void {
    const map = paintFace(card.map, card, this.look);
    if (map !== card.map) {
      card.map.dispose();
      card.map = map;
      card.face.value = map;
    }
    card.version = version;
    card.painted = { width: card.item.width, height: card.item.height };
    this.stale.delete(card);
  }

  private repaintSoon(): void {
    if (this.repaint !== null) clearTimeout(this.repaint);
    this.repaint = setTimeout(() => this.repaintNow(), REPAINT_AFTER_MS);
  }

  private repaintNow(): void {
    this.repaint = null;
    for (const card of this.cards.values()) {
      if (card.version === "" || this.stale.has(card)) {
        this.paint(card, faceVersion(card.shows.face, card.shows.selected));
      }
    }
    this.wake();
  }

  private add(item: CanvasNode, shows: Card["shows"]): Card {
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
    const group = new Group();
    group.add(new Mesh(this.plane, front), new Mesh(this.plane, back));
    const footprint = new Mesh(this.plane, cast);
    // After the cards: a shadow darkens a card on the plane below it, and a raised card hides it.
    footprint.renderOrder = 1;
    this.root.add(group, footprint);
    const card: Card = {
      group,
      footprint,
      materials: [front, back, cast],
      face,
      shade,
      map,
      version: "",
      painted: { width: -1, height: -1 },
      item,
      shows,
    };
    this.cards.set(item.id, card);
    return card;
  }

  // A card is a plane with no thickness, so a level view (front, side) sees
  // it edge-on and draws nothing of it until items have depth (plan step 3).
  // GAP [[01M41AB7YM5801ZJNM1Q647SYD]]
  private place(card: Card, z: number): void {
    const { item } = card;
    const cx = item.x + item.width / 2;
    const cy = item.y + item.height / 2;
    card.group.position.set(cx, -cy, z);
    card.group.scale.set(item.width + FACE_MARGIN * 2, item.height + FACE_MARGIN * 2, 1);
    // A raised card's shadow falls on the plane below it, larger and fainter the higher it is.
    const lift = Math.max(0, canvasDepth(item));
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
    this.stale.delete(card);
  }
}
