/**
 * Light study: a small still life in a room corner, lit by the kit's
 * three-point rig.
 *
 * The key is warm and casts soft shadows (PCF, blurred); the fill is a
 * hemisphere light that colours the shadow side from the hue family above
 * and the floor below; the rim, from behind, lifts the silhouettes off the
 * walls. Ambient occlusion (GTAO in the post chain) darkens the contacts —
 * where the objects meet the plinth and the plinth meets the floor.
 *
 * The toggles are the lessons: tone mapping (AgX, ACES, none — watch the
 * highlights on the glaze sphere clip without it), the finish (the kit's PBR
 * set against a matcap painted from the same palette), occlusion on and off,
 * and the key's angle.
 */
import {
  Group,
  Mesh,
  PCFSoftShadowMap,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
  CylinderGeometry,
  type Material,
} from "three/webgpu";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { LabControlValue, LabSceneInit, LabScene } from "@/components/lab/kit/contract";
import type { ScenePalette } from "@/scene/palette";
import { PanControl } from "@/components/lab/kit/pointer";
import {
  createRig,
  finishMaterial,
  matcapMaterial,
  paletteMatcap,
  type Finish,
} from "@/scene/gpu/rig";
import type { SceneStage, SceneToneMapping } from "@/scene/gpu/stage";
import { mountStudy, type StudyContext, type StudyParts } from "@/components/lab/kit/study";
import { Entrance } from "@/components/lab/kit/entrance";

/** Which palette colour and finish each piece of the still life takes (L1, L5). */
type Tint = keyof SceneStage["colors"];
interface Piece {
  readonly mesh: Mesh;
  readonly tint: Tint;
  readonly finish: Finish;
}

function piece(
  geometry: Mesh["geometry"],
  tint: Tint,
  finish: Finish,
  at: readonly [number, number, number],
): Piece {
  const mesh = new Mesh(geometry);
  mesh.position.set(...at);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { mesh, tint, finish };
}

function stillLife(): Piece[] {
  const floor = piece(new PlaneGeometry(14, 14), "ground", "matte", [0, 0, 0]);
  floor.mesh.rotation.x = -Math.PI / 2;
  const back = piece(new PlaneGeometry(14, 8), "ground", "matte", [0, 4, -3.2]);
  const side = piece(new PlaneGeometry(14, 8), "ground", "matte", [-3.2, 4, 0]);
  side.mesh.rotation.y = Math.PI / 2;
  const torus = piece(new TorusGeometry(0.42, 0.14, 32, 96), "ink", "metal", [-0.95, 0.56, 0.9]);
  torus.mesh.rotation.set(-Math.PI / 2.4, 0, 0.3);
  return [
    floor,
    back,
    side,
    piece(new RoundedBoxGeometry(2.4, 0.9, 1.6, 6, 0.12), "hue", "satin", [0, 0.45, 0]),
    piece(new SphereGeometry(0.55, 64, 48), "accent", "glaze", [0.45, 1.45, 0.1]),
    piece(new CylinderGeometry(0.28, 0.36, 1.3, 64), "ink", "satin", [-0.6, 1.55, -0.35]),
    piece(new RoundedBoxGeometry(0.5, 0.5, 0.5, 4, 0.06), "accent", "matte", [1.6, 0.25, 1.3]),
    torus,
  ];
}

function light(stage: SceneStage, init: LabSceneInit, context: StudyContext): StudyParts {
  stage.renderer.shadowMap.enabled = true;
  stage.renderer.shadowMap.type = PCFSoftShadowMap;
  const rig = createRig(init.palette, true);
  const turn = new Group();
  const pieces = stillLife();
  for (const p of pieces) turn.add(p.mesh);
  stage.scene.add(turn, ...rig.lights);
  stage.camera.fov = 26;
  stage.camera.position.set(9, 7.2, 9);
  stage.camera.lookAt(0, 1, 0);
  stage.backdrop();
  stage.atmosphere(16, 30);

  let finish: "pbr" | "matcap" = "pbr";
  let matcap = paletteMatcap(init.palette);
  const owned: Material[] = [];
  const dress = (palette: ScenePalette) => {
    for (const m of owned) m.dispose();
    owned.length = 0;
    matcap.dispose();
    matcap = paletteMatcap(palette);
    for (const p of pieces) {
      // The colour is the stage's palette uniform, so a theme change eases it across.
      const material = finish === "pbr" ? finishMaterial(p.finish) : matcapMaterial(matcap);
      if (finish === "pbr") material.colorNode = stage.colors[p.tint];
      owned.push(material);
      p.mesh.material = material;
    }
  };
  dress(init.palette);
  let palette = init.palette;
  let keyAngle = 140;
  const placeKey = () => rig.setKeyAngle((keyAngle * Math.PI) / 180, 7, 6);
  placeKey();
  const pan = new PanControl(
    context.host,
    { perPixel: 0.004, pitchLimit: 0, yawLimit: 0.7 },
    {
      onChange: () => stage.invalidate(),
    },
  );

  // Arriving, the lights come up: the key first, the fill and rim a beat behind.
  const entrance = new Entrance(init.timing);
  const full = { key: rig.key.intensity, fill: rig.fill.intensity, rim: rig.rim.intensity };
  const bringUp = () => {
    rig.key.intensity = full.key * entrance.arrived(0);
    rig.fill.intensity = full.fill * (0.15 + 0.85 * entrance.arrived(0.25));
    rig.rim.intensity = full.rim * entrance.arrived(0.45);
  };
  bringUp();

  return {
    frame: (dt) => {
      entrance.step(dt, context.reduced());
      bringUp();
      pan.frame(dt, context.reduced());
      turn.rotation.y = pan.pan.yaw;
    },
    setControl: (id, value: LabControlValue) => {
      if (id === "tone" && (value === "agx" || value === "aces" || value === "none")) {
        stage.setToneMapping(value satisfies SceneToneMapping);
      }
      if (id === "finish" && (value === "pbr" || value === "matcap")) {
        finish = value;
        dress(palette);
      }
      if (id === "ao" && typeof value === "boolean") stage.knobs.occlusion.value = value ? 1 : 0;
      if (id === "key" && typeof value === "number") {
        keyAngle = value;
        placeKey();
      }
    },
    setPalette: (next) => {
      palette = next;
      rig.setPalette(next);
      dress(next);
    },
    dispose: () => {
      pan.dispose();
      matcap.dispose();
      for (const m of owned) m.dispose();
    },
  };
}

export function mountLight(host: HTMLElement, init: LabSceneInit): Promise<LabScene> {
  return mountStudy(
    host,
    init,
    { fov: 26, bloom: { strength: 0.35, radius: 0.4 }, ao: true, vignette: 0.45 },
    light,
  );
}
