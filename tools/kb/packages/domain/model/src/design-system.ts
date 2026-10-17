/**
 * Which design system paints the page (DESIGN-UI.md → Design tokens → Design
 * systems): a setting of core's node (`sys.extension.core`), since the page
 * is core's and names no system. It is a ref to one of its field's
 * children: the systems are the options the seed fold derives from the
 * declarations' `designSystems`, as it derives backdrops'.
 */
import { declaredChoice, declaredOptionId, type DeclaredOptions } from "./declared-option.ts";
import { SYSTEM_IDS, type KbNode, type NodeId } from "./model.ts";

/** The design systems' options: the children of `sys.f.design-system`. */
export const DESIGN_SYSTEM_OPTIONS: DeclaredOptions = {
  field: SYSTEM_IDS.designSystemField,
  prefix: "sys.design-system.",
};

/** The option node that names the design system `id` under `sys.f.design-system`. */
export function designSystemOptionId(id: string): NodeId {
  return declaredOptionId(DESIGN_SYSTEM_OPTIONS, id);
}

/**
 * The design system `sources` choose, nearest first, among those
 * contributed (`contributed`, by id); null, the first contributed (core's
 * default), where none does. A system nobody contributes now is no choice.
 */
export function designSystemChoice(
  sources: readonly (KbNode["props"] | undefined)[],
  contributed: readonly string[],
): string | null {
  return declaredChoice(DESIGN_SYSTEM_OPTIONS, sources, contributed);
}
