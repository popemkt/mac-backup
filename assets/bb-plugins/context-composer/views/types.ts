// The contract every composer view meets: one composition and manifest in, decisions out. The list and the treemap are
// two renderers of it; the kb export is a third, outside the app. A new view joins VIEWS in views/index.ts.
import type { ComponentType } from "react";
import type { Artifact, Composition, Manifest, Source } from "../core/model.ts";
import type { Lever, Target } from "../core/targets.ts";

export type ViewProps = {
  composition: Composition;
  manifest: Manifest;
  target: Target;
  /** The lever that would remove an artifact on the target, as compiled for the current manifest when it is excluded. */
  leverOf(a: Artifact): Lever;
  toggle(a: Artifact): void;
  toggleSource(s: Source): void;
};

export type View = { id: string; label: string; component: ComponentType<ViewProps> };
