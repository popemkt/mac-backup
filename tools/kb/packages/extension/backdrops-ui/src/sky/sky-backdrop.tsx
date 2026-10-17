import type { BackdropProps } from "@kb/ui-sdk";
import { SceneStage } from "../scene/scene-stage";
import { createSky } from "./sky-scene";

/** The Sky backdrop: bats against the moon by night, swallows against the sun by day. */
export function SkyBackdrop(props: BackdropProps) {
  return <SceneStage factory={createSky} backdrop={props} />;
}
