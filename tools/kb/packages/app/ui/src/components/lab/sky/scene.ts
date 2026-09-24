/**
 * Sky: a starfield you can pan, under a sun or a moon that follows the theme.
 *
 * This study reads the graph (it may; the lab does not require it): every
 * node is a star, placed by its lens cluster so siblings gather into a
 * constellation, and the few most recently updated nodes are the glints.
 * Hovering a star names its node and draws its edges as faint constellation
 * lines; clicking opens it. The faint dust behind is decoration, never data.
 *
 * Motion: a drag turns the sky exactly; released, it coasts and decays (M3),
 * and the sun or moon follows the turn a beat behind (overlap). The one
 * ambient motion is a slow constant drift (M1, M4). A theme change sets one
 * body while the other rises, over the arrive duration (M6); the stage eases
 * the sky's colours across meanwhile.
 */
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  LineBasicNodeMaterial,
  LineSegments,
  Sprite,
  SpriteNodeMaterial,
  Vector3,
} from "three/webgpu";
import {
  exp,
  float,
  instancedBufferAttribute,
  instanceIndex,
  select,
  sin,
  uniform,
} from "three/tsl";
import type { LabControlValue, LabSceneInit, LabScene } from "@/components/lab/kit/contract";
import type { LabGraph, LabNode } from "@/components/lab/lab-graph";
import { SKY_PAN } from "@/components/lab/kit/pan";
import { PanControl, PointerField } from "@/components/lab/kit/pointer";
import type { LabStage } from "@/components/lab/kit/stage";
import { mountStudy, type StudyContext, type StudyParts } from "@/components/lab/kit/study";
import { approach, approachRate, easeAt } from "@/components/lab/kit/timing";
import { skyDirection, starPlace, unitHash } from "@/components/lab/sky/layout";
import { dome, moon, quad, starLight, sun } from "@/components/lab/sky/shaders";

const STAR_RADIUS = 60;
const DUST = 1400;
/** Where the sun and moon hang before any pan: up and to the right. */
const BODY_HOME = new Vector3(0.42, 0.22, -1).normalize().multiplyScalar(48);
const BODY_SIZE = 11;
/** How far a setting body sinks below its place as the other rises. */
const BODY_SET = 16;
/** Pixels within which the pointer is on a star; a glint is easier to hit. */
const HIT_STAR = 10;
const HIT_GLINT = 18;
/** The sky's own slow turn (rad/s): about 17 minutes a revolution (M4). */
const DRIFT = 0.006;

function uniforms() {
  return {
    time: uniform(0),
    twinkle: uniform(1),
    hover: uniform(-1),
    spikes: uniform(1),
    nebula: uniform(0.32),
    sunStrength: uniform(1),
    moonStrength: uniform(0),
  };
}
type SkyUniforms = ReturnType<typeof uniforms>;

/** The node stars: one sprite drawn once per node, per-instance look from attributes. */
function nodeStars(stage: LabStage, u: SkyUniforms, nodes: readonly LabNode[]) {
  const n = Math.max(1, nodes.length);
  const positions = new Float32Array(n * 3);
  const looks = new Float32Array(n * 4);
  const local = nodes.map((node, i) => {
    const [x, y, z] = skyDirection(starPlace(node));
    const at = new Vector3(x, y, z).multiplyScalar(STAR_RADIUS);
    positions.set([at.x, at.y, at.z], i * 3);
    const glint = node.glint ? 0.45 + node.recency * 0.55 : 0;
    const size = node.glint
      ? 5 + node.recency * 3
      : 0.9 + Math.min(1.2, Math.sqrt(node.degree) * 0.28);
    looks.set(
      [size, glint, unitHash(`${node.id}:twinkle`) * Math.PI * 2, 0.6 + node.recency * 0.4],
      i * 4,
    );
    return at;
  });
  const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false });
  const look = instancedBufferAttribute(new InstancedBufferAttribute(looks, 4));
  const hovered = u.hover.equal(instanceIndex.toFloat());
  material.positionNode = instancedBufferAttribute(new InstancedBufferAttribute(positions, 3));
  material.scaleNode = select(hovered, look.x.mul(1.8).add(1.5), look.x);
  const shimmer = sin(u.time.mul(0.8).add(look.z)).mul(0.2).mul(u.twinkle).add(1);
  material.colorNode = stage.colors.ink;
  material.opacityNode = starLight(select(hovered, float(1), look.y), u.spikes)
    .mul(shimmer)
    .mul(look.w)
    .min(1);
  const sprite = new Sprite(material);
  sprite.count = nodes.length;
  sprite.frustumCulled = false;
  return { sprite, local };
}

/** Decoration only: a seeded field of faint, tiny, still stars. */
function dust(stage: LabStage): Sprite {
  const positions = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST; i++) {
    const [x, y, z] = skyDirection({
      yaw: unitHash(`dust:${i}:yaw`) * Math.PI * 2,
      pitch: Math.asin(unitHash(`dust:${i}:pitch`) * 2 - 1),
    });
    positions.set([x * 90, y * 90, z * 90], i * 3);
  }
  const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false });
  material.positionNode = instancedBufferAttribute(new InstancedBufferAttribute(positions, 3));
  material.scaleNode = float(0.55);
  material.colorNode = stage.colors.ink;
  const q = quad();
  material.opacityNode = exp(q.dot(q).mul(-30)).mul(0.4);
  const sprite = new Sprite(material);
  sprite.count = DUST;
  sprite.frustumCulled = false;
  return sprite;
}

/** The hovered node's edges, drawn as constellation lines between its stars. */
function constellation(
  lines: LineSegments,
  graph: LabGraph,
  local: readonly Vector3[],
  node: LabNode | undefined,
): void {
  const points: number[] = [];
  if (node !== undefined) {
    const index = new Map(graph.nodes.map((n, i) => [n.id, i]));
    const from = local[index.get(node.id) ?? -1];
    for (const edge of graph.edges) {
      const other =
        edge.source === node.id ? edge.target : edge.target === node.id ? edge.source : null;
      const to = other === null ? undefined : local[index.get(other) ?? -1];
      if (from !== undefined && to !== undefined)
        points.push(from.x, from.y, from.z, to.x, to.y, to.z);
    }
  }
  lines.geometry.dispose();
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(points, 3));
  lines.geometry = geometry;
  // An empty batch is not drawn: a zero-vertex draw is not free.
  lines.visible = points.length > 0;
}

interface Hit {
  index: number;
  x: number;
  y: number;
}

const projected = new Vector3();

/** The node star nearest the pointer, preferring glints, within reach; written into `hit`. */
function nearestStar(
  { local, nodes }: { readonly local: readonly Vector3[]; readonly nodes: readonly LabNode[] },
  turn: Group,
  stage: LabStage,
  pointer: PointerField,
  hit: Hit,
): void {
  const width = stage.renderer.domElement.clientWidth;
  const height = stage.renderer.domElement.clientHeight;
  let bestScore = Infinity;
  hit.index = -1;
  for (let i = 0; i < local.length; i++) {
    const at = local[i];
    const node = nodes[i];
    if (at === undefined || node === undefined) continue;
    projected.copy(at).applyMatrix4(turn.matrixWorld).project(stage.camera);
    if (projected.z > 1) continue;
    const x = ((projected.x + 1) / 2) * width;
    const y = ((1 - projected.y) / 2) * height;
    const distance = Math.hypot(x - pointer.x, y - pointer.y);
    const score = distance - (node.glint ? 6 : 0);
    if (distance <= (node.glint ? HIT_GLINT : HIT_STAR) && score < bestScore) {
      bestScore = score;
      hit.index = i;
      hit.x = x;
      hit.y = y;
    }
  }
}

function sky(stage: LabStage, init: LabSceneInit, context: StudyContext): StudyParts {
  const u = uniforms();
  const turn = new Group();
  const bodies = new Group();
  const sunSprite = sun(stage.colors, u.sunStrength);
  const moonSprite = moon(stage.colors, u.moonStrength);
  for (const body of [sunSprite, moonSprite]) {
    body.scale.setScalar(BODY_SIZE);
    bodies.add(body);
  }
  const lineMaterial = new LineBasicNodeMaterial({ transparent: true, depthWrite: false });
  lineMaterial.colorNode = stage.colors.ink;
  lineMaterial.opacityNode = float(0.35);
  const lines = new LineSegments(new BufferGeometry(), lineMaterial);
  lines.frustumCulled = false;
  lines.visible = false;
  turn.add(dome(stage.colors, u.nebula), dust(stage), lines);
  stage.scene.add(turn, bodies);
  stage.camera.position.set(0, 0, 0);
  stage.camera.lookAt(0, 0, -1);

  let graph = init.graph;
  let stars = nodeStars(stage, u, graph.nodes);
  turn.add(stars.sprite);
  let day = init.dark ? 0 : 1;
  let dayTarget = day;
  const dayRate = approachRate(init.timing.arrive);
  const followRate = approachRate(init.timing.follow);
  let bodyYaw = 0;
  let bodyPitch = 0;
  let hovered = -1;
  let hoverX = 0;
  let hoverY = 0;
  const pointer = new PointerField(context.host);
  const pan = new PanControl(context.host, SKY_PAN, {
    onChange: () => stage.invalidate(),
    onTap: () => {
      const node = graph.nodes[hovered];
      if (node !== undefined) init.onOpen(node.id);
    },
  });

  const setHovered = (index: number, x: number, y: number) => {
    const moved = Math.abs(x - hoverX) + Math.abs(y - hoverY) > 0.75;
    if (index === hovered && !moved) return;
    if (index !== hovered) constellation(lines, graph, stars.local, graph.nodes[index]);
    hovered = index;
    hoverX = x;
    hoverY = y;
    u.hover.value = index;
    const node = graph.nodes[index];
    init.onHover(node === undefined ? null : { id: node.id, label: node.label, x, y });
  };

  const hit: Hit = { index: -1, x: 0, y: 0 };
  const hitTest = () => {
    if (pan.dragging) return;
    if (pointer.inside)
      nearestStar({ local: stars.local, nodes: graph.nodes }, turn, stage, pointer, hit);
    else hit.index = -1;
    setHovered(hit.index, hit.x, hit.y);
  };

  const placeBodies = (dt: number) => {
    const reduced = context.reduced();
    const p = pan.pan;
    bodyYaw = reduced ? p.yaw : approach(bodyYaw, p.yaw, followRate, dt);
    bodyPitch = reduced ? p.pitch : approach(bodyPitch, p.pitch, followRate, dt);
    bodies.rotation.set(bodyPitch, bodyYaw, 0, "YXZ");
    day = reduced ? dayTarget : approach(day, dayTarget, dayRate, dt);
    const eased = easeAt(init.timing.settle, day);
    sunSprite.position.copy(BODY_HOME).setY(BODY_HOME.y - (1 - eased) * BODY_SET);
    moonSprite.position.copy(BODY_HOME).setY(BODY_HOME.y - eased * BODY_SET);
    u.sunStrength.value = eased;
    u.moonStrength.value = 1 - eased;
  };
  placeBodies(0);

  return {
    frame: (dt, elapsed) => {
      u.time.value = elapsed;
      const reduced = context.reduced();
      u.twinkle.value = reduced ? 0 : 1;
      pan.frame(dt, reduced);
      if (!pan.dragging && !reduced) pan.pan.yaw += DRIFT * dt;
      turn.rotation.set(pan.pan.pitch, pan.pan.yaw, 0, "YXZ");
      placeBodies(dt);
      stage.scene.updateMatrixWorld();
      hitTest();
    },
    setControl: (id, value: LabControlValue) => {
      if (id === "spikes" && typeof value === "number") u.spikes.value = value;
      if (id === "nebula" && typeof value === "number") u.nebula.value = value;
      if (id === "dither" && typeof value === "boolean") stage.knobs.dither.value = value ? 1 : 0;
    },
    setPalette: (_palette, dark) => {
      dayTarget = dark ? 0 : 1;
      u.twinkle.value = context.reduced() ? 0 : 1;
      stage.setBloom(dark ? 0.8 : 0.5);
    },
    setGraph: (next: LabGraph) => {
      graph = next;
      turn.remove(stars.sprite);
      stars.sprite.geometry.dispose();
      for (const m of [stars.sprite.material].flat()) m.dispose();
      stars = nodeStars(stage, u, graph.nodes);
      turn.add(stars.sprite);
      setHovered(-1, 0, 0);
    },
    dispose: () => {
      pointer.dispose();
      pan.dispose();
      lines.geometry.dispose();
    },
  };
}

export function mountSky(host: HTMLElement, init: LabSceneInit): Promise<LabScene> {
  return mountStudy(
    host,
    init,
    { fov: 58, bloom: { strength: 0.8, radius: 0.5 }, vignette: 0.35 },
    sky,
  );
}
