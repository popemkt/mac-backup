import { viewKey } from "@/lib/plugins";

/** The lab plugin's namespace and view keys: what a host imports, never the components. */
export const LAB_NAMESPACE = "lab";

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

export interface LabParams {
  readonly scene: LabSceneId;
}

/** The lab, showing one study. */
export const LabView = viewKey<LabParams>()(`${LAB_NAMESPACE}.page`);
