/**
 * The 3D canvas's standing labels (`canvas-scene`): the face of a solid that
 * stands (`faceStands` in `@kb/canvas`) — a sphere's or a cone's, which have
 * no flat top to carry it, and a solid billboard's — drawn as a label square
 * to the camera in front of its body (`frontFrame`), turned again whenever
 * the view turns. A label is its face's words on a pill of card stock
 * (`paintLabel`), repainted only when they or the selection change; it is
 * a look, not a surface: the pointer takes the solid by its body.
 */
import {
  CanvasTexture,
  Group,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
} from "three/webgpu";
import { texture } from "three/tsl";
import {
  TOP_AXES,
  canvasDepth,
  faceStands,
  frontFrame,
  paintOrder,
  type CanvasAxes,
  type CanvasNode,
} from "@kb/canvas";
import { paintPlanes } from "./canvas-camera";
import { cardFaceOf, faceWords, paintLabel, type CardLook } from "./canvas-card-face";
import type { FacePicture } from "./canvas-face-pictures";
import type { CanvasSceneContent } from "./canvas-scene-content";
import { faceDensity } from "./canvas-scene-items";
import { matrixToThree, toThree } from "./canvas-scene-space";

interface Label {
  readonly mesh: Mesh;
  readonly material: MeshBasicNodeMaterial;
  readonly map: ReturnType<typeof texture>;
  canvas: HTMLCanvasElement;
  painted: CanvasTexture;
  /** What it was painted from: its words, its size and whether it was selected. */
  version: string;
  item: CanvasNode;
  z: number;
}

/** A label's words never ask for a picture: an image has none. */
const NO_PICTURE = (): FacePicture => ({ state: "loading" });

export class LabelLayer {
  readonly root = new Group();
  private readonly labels = new Map<string, Label>();
  private readonly plane = new PlaneGeometry(1, 1);
  /** Scratch for a label's turn in three's world. */
  private readonly turn = new Matrix4();
  private axes: CanvasAxes = TOP_AXES;
  private look: CardLook;

  constructor(look: CardLook) {
    this.look = look;
  }

  setLook(look: CardLook): void {
    this.look = look;
    for (const label of this.labels.values()) label.version = "";
  }

  /** Item ids with a standing label, back to front. */
  get ids(): readonly string[] {
    return [...this.labels.keys()];
  }

  sync(content: CanvasSceneContent): void {
    const seen = new Set<string>();
    for (const { item, z } of paintPlanes(paintOrder(content.doc.nodes))) {
      if (!faceStands(item) || canvasDepth(item) <= 0) continue;
      seen.add(item.id);
      const label = this.labels.get(item.id) ?? this.add(item.id);
      label.item = item;
      label.z = z;
      const words = faceWords(cardFaceOf(item, content.nodes, NO_PICTURE));
      const selected = content.selection.nodeIds.has(item.id);
      const version = `${selected ? "s" : "-"}${item.width}x${item.height}:${words}`;
      if (label.version !== version) this.paint(label, words, selected, version);
      this.orient(label);
    }
    for (const [id, label] of this.labels) {
      if (seen.has(id)) continue;
      this.remove(label);
      this.labels.delete(id);
    }
  }

  /** Turn every label square to a camera looking along `axes`. */
  face(axes: CanvasAxes): void {
    this.axes = axes;
    for (const label of this.labels.values()) this.orient(label);
  }

  /** Where label `id` is drawn, in three's world: its four corners, clockwise from its top left. */
  cornersOf(id: string): Vector3[] | null {
    const label = this.labels.get(id);
    if (label === undefined) return null;
    label.mesh.updateMatrixWorld(true);
    return [
      [-0.5, 0.5],
      [0.5, 0.5],
      [0.5, -0.5],
      [-0.5, -0.5],
    ].map(([x = 0, y = 0]) => label.mesh.localToWorld(new Vector3(x, y, 0)));
  }

  dispose(): void {
    for (const label of this.labels.values()) this.remove(label);
    this.labels.clear();
    this.plane.dispose();
  }

  private add(id: string): Label {
    const canvas = document.createElement("canvas");
    const painted = new CanvasTexture(canvas);
    painted.colorSpace = SRGBColorSpace;
    const map = texture(painted);
    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    // The label's own alpha is its pill's: an opacity node would multiply it in twice.
    material.colorNode = map;
    const mesh = new Mesh(this.plane, material);
    mesh.name = id;
    // Over what it stands in front of, as a card's face is.
    mesh.renderOrder = 2;
    this.root.add(mesh);
    const label: Label = {
      mesh,
      material,
      map,
      canvas,
      painted,
      version: "",
      item: { id, type: "text", text: "", x: 0, y: 0, width: 1, height: 1 },
      z: 0,
    };
    this.labels.set(id, label);
    return label;
  }

  private paint(label: Label, words: string, selected: boolean, version: string): void {
    const { width, height } = label.item;
    const density = faceDensity(width, height);
    const pixelsW = Math.max(1, Math.ceil(width * density));
    const pixelsH = Math.max(1, Math.ceil(height * density));
    const fits = label.canvas.width === pixelsW && label.canvas.height === pixelsH;
    if (!fits) {
      // A GPU texture keeps the size it was made at: a new size is a new texture.
      label.canvas = document.createElement("canvas");
      label.canvas.width = pixelsW;
      label.canvas.height = pixelsH;
      const next = new CanvasTexture(label.canvas);
      next.colorSpace = SRGBColorSpace;
      label.painted.dispose();
      label.painted = next;
      label.map.value = next;
    }
    const ctx = label.canvas.getContext("2d");
    if (ctx !== null) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, pixelsW, pixelsH);
      ctx.setTransform(density, 0, 0, density, 0, 0);
      paintLabel(ctx, words, { width, height, selected }, this.look);
    }
    label.painted.needsUpdate = true;
    label.version = version;
  }

  /** Stand the label in front of its solid, square to the camera. */
  private orient(label: Label): void {
    const frame = frontFrame(label.item, this.axes, label.z);
    toThree(frame.centre, label.mesh.position);
    label.mesh.quaternion.setFromRotationMatrix(matrixToThree(frame.matrix, this.turn));
    label.mesh.scale.set(frame.half.x * 2, frame.half.y * 2, 1);
  }

  private remove(label: Label): void {
    this.root.remove(label.mesh);
    label.material.dispose();
    label.painted.dispose();
  }
}
