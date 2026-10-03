import { Schema } from "effect";
import { viewKey } from "./view-key.ts";

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

export const LabParams = Schema.Struct({ scene: Schema.Literals(LAB_SCENE_IDS) }).annotate({
  description:
    "The lab, showing one visual study. Its params come from the route: a view node holds none.",
});
export type LabParams = typeof LabParams.Type;

/** The lab, showing one study. */
export const LabView = viewKey(`${LAB_NAMESPACE}.page`, "Lab", LabParams);
