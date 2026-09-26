/**
 * River: 131 072 particles carried by a curl-noise flow (`flow.ts`), each
 * drawn as a short streak along its own velocity.
 *
 * A particle is a sprite stretched along where it is going: its length is
 * its speed on screen, its angle the screen direction of its velocity (the
 * velocity taken into view space). Slow water is the hue, faster the accent,
 * and only the fastest runs past 1 into HDR, so only the river's rapids
 * bloom (L2). A particle fades in at birth and out at the end of its life,
 * so recycling never pops (P2).
 *
 * Move the pointer through the water to stir a vortex; orbit to see the
 * channel in depth. On a light ground the water is ink, on a dark one light.
 */
import { Sprite, SpriteNodeMaterial, Vector3 } from "three/webgpu";
import {
  atan,
  cameraViewMatrix,
  exp,
  float,
  hash,
  instanceIndex,
  length,
  mix,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec4,
} from "three/tsl";
import type { LabControlValue, LabSceneInit, LabScene } from "@/components/lab/kit/contract";
import { numberOf } from "@/components/lab/kit/contract";
import { OrbitControl } from "@/components/lab/kit/orbit";
import { PointerField } from "@/components/lab/kit/pointer";
import { Entrance } from "@/components/lab/kit/entrance";
import { labBackdrop } from "@/components/lab/kit/backdrop";
import type { PaletteUniforms, SceneStage } from "@/scene/gpu/stage";
import type { TslNode } from "@/scene/gpu/tsl";
import { mountStudy, type StudyContext, type StudyParts } from "@/components/lab/kit/study";
import { PARTICLES, riverFlow, type FlowBuffers } from "@/components/lab/river/flow";

const DRIFT = 0.012;
/** Where the pointer is parked while it stirs nothing. */
const AWAY = 1000;

function streaks(
  colors: PaletteUniforms,
  b: FlowBuffers,
  look: { readonly streak: TslNode; readonly dark: TslNode; readonly arrival: TslNode },
): Sprite {
  const state = b.position.element(instanceIndex);
  const motion = b.velocity.element(instanceIndex);
  const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false });
  material.fog = false;
  material.positionNode = state.xyz;
  const seen = cameraViewMatrix.mul(vec4(motion.xyz, 0)).xy;
  const speed = length(motion.xyz);
  material.rotationNode = atan(seen.y, seen.x);
  // Streaks are the fill cost: each is a blended quad, so length and width are kept lean (P3).
  material.scaleNode = vec2(length(seen).mul(look.streak).add(0.025), 0.018);
  // Slow water in the hue, faster in the accent, the rapids past 1.
  const pace = smoothstep(0.8, 4.5, speed);
  const bright = mix(mix(colors.hue, colors.ink, 0.35), colors.accent, pace).mul(
    float(0.9).add(smoothstep(0.75, 1, pace).mul(1.6)),
  );
  const inked = mix(colors.ink, colors.hue, pace.mul(0.6));
  material.colorNode = mix(inked, bright, look.dark);
  const q = uv().sub(0.5).mul(2);
  const capsule = exp(q.x.mul(q.x).mul(-3).add(q.y.mul(q.y).mul(-9)));
  const life = smoothstep(0, 0.6, state.w).mul(
    float(1).sub(smoothstep(motion.w.sub(1), motion.w, state.w)),
  );
  const order = hash(instanceIndex.toFloat());
  material.opacityNode = capsule
    .mul(life)
    .mul(mix(float(0.55), float(0.42), look.dark))
    // Arriving, the water appears particle by particle in a seeded order.
    .mul(smoothstep(order, order.add(0.15), look.arrival.mul(1.15)));
  const sprite = new Sprite(material);
  sprite.count = PARTICLES;
  sprite.frustumCulled = false;
  return sprite;
}

function river(stage: SceneStage, init: LabSceneInit, context: StudyContext): StudyParts {
  const flow = riverFlow();
  const { u } = flow;
  u.speed.value = numberOf(init.values, "speed", 1);
  u.scale.value = numberOf(init.values, "scale", 0.45);
  u.turbulence.value = numberOf(init.values, "turbulence", 1);
  const streak = uniform(numberOf(init.values, "streak", 0.035));
  const dark = uniform(init.dark ? 1 : 0);
  const clock = uniform(0);
  const entrance = new Entrance(init.timing);
  stage.scene.add(
    streaks(stage.colors, flow.buffers, {
      streak: float(streak),
      dark: float(dark),
      arrival: entrance.arrival(float(0)),
    }),
  );
  stage.scene.backgroundNode = labBackdrop(stage.colors, float(clock), {
    focus: [0.5, 0.5],
    warmth: 0.3,
    haze: 0.8,
  });
  const orbit = new OrbitControl(
    context.host,
    { perPixel: 0.004, pitch: [-0.6, 1.1], distance: [7, 30] },
    { yaw: 0.25, pitch: 0.28, distance: 17, target: { x: 0, y: 0, z: 0 } },
    init.timing,
    { onChange: () => stage.invalidate() },
  );
  const pointer = new PointerField(context.host);
  const aim = new Vector3();
  const origin = new Vector3();

  return {
    frame: (dt, elapsed) => {
      const reduced = context.reduced();
      entrance.step(dt, reduced);
      orbit.frame(dt, reduced, stage.camera, DRIFT);
      clock.value = elapsed;
      if (dt <= 0) return;
      const live =
        pointer.inside &&
        !orbit.control.dragging &&
        pointer.idleFor(performance.now()) <= 2 &&
        pointer.onFacing(stage.camera, origin, aim);
      if (live) u.pointer.value.copy(aim);
      else u.pointer.value.set(AWAY, AWAY, AWAY);
      stage.camera.getWorldDirection(u.axis.value).negate();
      u.dt.value = dt;
      u.time.value = elapsed;
      void stage.renderer.compute(flow.pass);
    },
    setControl: (id, value: LabControlValue) => {
      if (typeof value !== "number") return;
      if (id === "speed") u.speed.value = value;
      if (id === "scale") u.scale.value = value;
      if (id === "turbulence") u.turbulence.value = value;
      if (id === "streak") streak.value = value;
    },
    setPalette: (_palette, isDark) => {
      dark.value = isDark ? 1 : 0;
    },
    dispose: () => {
      pointer.dispose();
      orbit.dispose();
      flow.pass.dispose();
    },
  };
}

export function mountRiver(host: HTMLElement, init: LabSceneInit): Promise<LabScene> {
  return mountStudy(
    host,
    init,
    { fov: 40, bloom: { strength: 0.7, radius: 0.5 }, vignette: 0.5 },
    river,
  );
}
