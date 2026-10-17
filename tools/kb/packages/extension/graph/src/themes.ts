/**
 * The graph's themes as a declared kind (DESIGN.md → Extension families →
 * Declared options; DESIGN-UI.md → Graph → Graph themes): `lens.theme`'s
 * options, `sys.graph.theme.<id>`, one per theme a family declares and its
 * page plugin contributes to the graph's theme point. The graph family seeds
 * the field, so it owns the kind and its own themes' keys have no family
 * part; another family's are `<family>.<local id>`. Matte is the default.
 */
import type { DeclaredOptions, SeedOption } from "@kb/model";
import { GRAPH_IDS } from "./ids.ts";

export const GRAPH_THEME_OPTIONS: DeclaredOptions = {
  field: GRAPH_IDS.lensThemeField,
  prefix: "sys.graph.theme.",
};

export const MATTE_THEME: SeedOption = { id: "matte", label: "Matte" };
export const CEL_THEME: SeedOption = { id: "cel", label: "Cel" };
export const FRESNEL_THEME: SeedOption = { id: "fresnel", label: "Fresnel" };
export const GLASS_THEME: SeedOption = { id: "glass", label: "Glass" };
export const BULLET_THEME: SeedOption = { id: "bullet", label: "Bullet" };
export const CUBE_THEME: SeedOption = { id: "cube", label: "Cube" };
