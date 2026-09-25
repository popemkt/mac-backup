/**
 * The 3D graph's labels: a sprite per labelled node, its text painted once
 * into a texture in the graph face with a halo of the ground behind it, so it
 * stays legible over links and other nodes. Each frame the labels are placed
 * in screen space in priority order (focus first, then size) and a label that
 * would overlap one already placed, fall off the frame, or sit behind the
 * camera is hidden — the same reservation the 2D renderers use. A label's
 * opacity follows its node's eased emphasis.
 *
 * Textures are made when a label is first needed and kept until the palette
 * or the graph changes; a hover never repaints one.
 */
import {
  CanvasTexture,
  SRGBColorSpace,
  Sprite,
  SpriteNodeMaterial,
  Vector3,
  type Group,
  type PerspectiveCamera,
} from "three/webgpu";
import { texture, uniform } from "three/tsl";
import { fitGraphLabel, graphLabelFont } from "@/lib/graph-label";
import { reserveGraphLabel, type GraphLabelBox } from "@/lib/graph-label-layout";
import type { ScenePalette } from "@/scene/palette";
import type { Force3dFades, Force3dTopology } from "./force3d-emphasis";

const FONT_SIZE = 12;
const PAD_X = 6;
const HEIGHT = 24;
/** Canvas pixels per CSS pixel, before the device ratio. */
const OVERSAMPLE = 2;

interface Label {
  readonly node: number;
  readonly sprite: Sprite;
  readonly width: number;
  readonly box: GraphLabelBox;
  readonly opacity: ReturnType<typeof uniform<number>>;
  dispose(): void;
}

function paint(text: string, palette: ScenePalette, font: string) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("Canvas 2D context unavailable");
  const scale = OVERSAMPLE * Math.min(window.devicePixelRatio || 1, 2);
  ctx.font = `500 ${FONT_SIZE}px ${font}`;
  const label = fitGraphLabel(text, (t) => ctx.measureText(t).width);
  const width = Math.ceil(ctx.measureText(label).width) + PAD_X * 2;
  canvas.width = width * scale;
  canvas.height = HEIGHT * scale;
  ctx.scale(scale, scale);
  ctx.font = `500 ${FONT_SIZE}px ${font}`;
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  // The halo: the ground, drawn wide and soft under the text.
  ctx.strokeStyle = palette.ground;
  ctx.lineWidth = 4;
  ctx.shadowColor = palette.ground;
  ctx.shadowBlur = 6;
  ctx.strokeText(label, PAD_X, HEIGHT / 2);
  ctx.shadowBlur = 0;
  ctx.fillStyle = palette.ink;
  ctx.fillText(label, PAD_X, HEIGHT / 2);
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  return { map, width };
}

export class LabelLayer {
  private readonly labels = new Map<number, Label>();
  private readonly occupied: GraphLabelBox[] = [];
  private readonly order: Label[] = [];
  private readonly point = new Vector3();
  private readonly up = new Vector3();
  private readonly focusDisc: GraphLabelBox = { x: 0, y: 0, width: 0, height: 0 };
  private pixelScale = 1;
  private readonly group: Group;
  private topology: Force3dTopology;
  private palette: ScenePalette;

  constructor(group: Group, topology: Force3dTopology, palette: ScenePalette) {
    this.group = group;
    this.topology = topology;
    this.palette = palette;
  }

  /** Which nodes carry a label now; others' sprites are hidden, not dropped. */
  want(nodes: ReadonlySet<number>): void {
    const font = graphLabelFont();
    for (const i of nodes) {
      if (this.labels.has(i)) continue;
      const node = this.topology.nodes[i];
      if (node === undefined) continue;
      const { map, width } = paint(node.label, this.palette, font);
      const opacity = uniform(1);
      const material = new SpriteNodeMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      material.fog = false;
      material.sizeAttenuation = false;
      const sample = texture(map);
      material.colorNode = sample.rgb;
      material.opacityNode = sample.a.mul(opacity);
      const sprite = new Sprite(material);
      sprite.center.set(0.5, -0.15);
      sprite.renderOrder = 10;
      sprite.scale.set(width * this.pixelScale, HEIGHT * this.pixelScale, 1);
      this.group.add(sprite);
      this.labels.set(i, {
        node: i,
        sprite,
        width,
        box: { x: 0, y: 0, width: 0, height: 0 },
        opacity,
        dispose: () => {
          map.dispose();
          material.dispose();
        },
      });
    }
    this.order.length = 0;
    for (const label of this.labels.values()) {
      label.sprite.visible = false;
      if (nodes.has(label.node)) this.order.push(label);
    }
  }

  /** The camera's field of view and the viewport height set a CSS pixel's size. */
  resize(camera: PerspectiveCamera, height: number): void {
    this.pixelScale = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, height);
    for (const label of this.labels.values())
      label.sprite.scale.set(label.width * this.pixelScale, HEIGHT * this.pixelScale, 1);
  }

  /** Place, reserve and fade every wanted label for this frame. */
  frame(
    positions: Float32Array,
    camera: PerspectiveCamera,
    { width, height }: { readonly width: number; readonly height: number },
    fades: Force3dFades,
    radius: (i: number) => number,
  ): void {
    const focus = fades.focus.values;
    // A label stands just above its node's silhouette, whatever the node's size.
    this.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    this.order.sort(
      (a, b) =>
        (focus[b.node] ?? 0) - (focus[a.node] ?? 0) ||
        (this.topology.nodes[b.node]?.size ?? 0) - (this.topology.nodes[a.node]?.size ?? 0) ||
        a.node - b.node,
    );
    this.occupied.length = 0;
    // The node in focus keeps its own disc: no other label is laid over it.
    const focal = height / 2 / Math.tan((camera.fov * Math.PI) / 360);
    for (const label of this.order) {
      const i = label.node;
      if ((focus[i] ?? 0) < 0.5) continue;
      this.point.set(positions[i * 3] ?? 0, positions[i * 3 + 1] ?? 0, positions[i * 3 + 2] ?? 0);
      const r = (radius(i) * focal) / Math.max(1, this.point.distanceTo(camera.position));
      this.point.project(camera);
      const x = ((this.point.x + 1) / 2) * width;
      const y = ((1 - this.point.y) / 2) * height;
      this.focusDisc.x = x - r;
      this.focusDisc.y = y - r;
      this.focusDisc.width = this.focusDisc.height = 2 * r;
      this.occupied.push(this.focusDisc);
    }
    for (const label of this.order) {
      const i = label.node;
      this.point
        .set(positions[i * 3] ?? 0, positions[i * 3 + 1] ?? 0, positions[i * 3 + 2] ?? 0)
        .addScaledVector(this.up, radius(i));
      label.sprite.position.copy(this.point);
      this.point.project(camera);
      const x = ((this.point.x + 1) / 2) * width;
      const y = ((1 - this.point.y) / 2) * height;
      const box = label.box;
      box.x = x - label.width / 2 - 3;
      box.y = y - HEIGHT * 1.15 - 2;
      box.width = label.width + 6;
      box.height = HEIGHT + 4;
      const present = fades.dim.values[i] ?? 1;
      label.sprite.visible =
        this.point.z < 1 &&
        present > 0.5 &&
        box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= width &&
        box.y + box.height <= height &&
        reserveGraphLabel(box, this.occupied);
      label.opacity.value = Math.min(1, (present - 0.5) * 2);
    }
  }

  /** A new palette or graph: every texture is repainted on next want. */
  reset(topology: Force3dTopology, palette: ScenePalette): void {
    this.dispose();
    this.topology = topology;
    this.palette = palette;
  }

  dispose(): void {
    for (const label of this.labels.values()) {
      this.group.remove(label.sprite);
      label.dispose();
    }
    this.labels.clear();
    this.order.length = 0;
  }
}
