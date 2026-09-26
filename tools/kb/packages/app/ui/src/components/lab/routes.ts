import type { SurfaceParams } from "@/lib/plugins";

/** The lab plugin's namespace and surface id, derived once. */
export const LAB_NAMESPACE = "lab";
export const LAB_PAGE = "page";
export const LAB_SURFACE = `${LAB_NAMESPACE}.${LAB_PAGE}`;

/** The studies the lab shows, in switcher order; the first is `/lab`'s. */
export const LAB_SCENE_IDS = [
  "embers",
  "sky",
  "glass",
  "river",
  "ocean",
  "light",
  "motion",
] as const;
export type LabSceneId = (typeof LAB_SCENE_IDS)[number];

function isLabScene(value: string): value is LabSceneId {
  return LAB_SCENE_IDS.some((id) => id === value);
}

/** `/lab` (the first scene) or `/lab/<scene>`; an unknown study is not the lab's. */
export function matchLab(path: string): SurfaceParams | null {
  if (path === "/lab" || path === "/lab/") return { scene: LAB_SCENE_IDS[0] };
  const scene = /^\/lab\/([^/]+)\/?$/.exec(path)?.[1];
  return scene !== undefined && isLabScene(scene) ? { scene } : null;
}

/** The scene a matched route names, for a page that reads its params. */
export function labSceneOf(params: SurfaceParams): LabSceneId {
  const scene = params["scene"];
  return scene !== undefined && isLabScene(scene) ? scene : LAB_SCENE_IDS[0];
}

export function labPath(scene: LabSceneId): string {
  return `/lab/${scene}`;
}
