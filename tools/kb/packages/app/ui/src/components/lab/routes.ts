import { LAB_SCENE_IDS, type LabParams, type LabSceneId } from "@/components/lab/views";

function isLabScene(value: string): value is LabSceneId {
  return LAB_SCENE_IDS.some((id) => id === value);
}

/** `/lab` (the first scene) or `/lab/<scene>`; an unknown study is not the lab's. */
export function matchLab(path: string): LabParams | null {
  if (path === "/lab" || path === "/lab/") return { scene: LAB_SCENE_IDS[0] };
  const scene = /^\/lab\/([^/]+)\/?$/.exec(path)?.[1];
  return scene !== undefined && isLabScene(scene) ? { scene } : null;
}

export function labPath(scene: LabSceneId): string {
  return `/lab/${scene}`;
}
