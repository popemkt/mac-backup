/**
 * Option previews (DESIGN-UI.md → Option previews): a live sample of each
 * option of one declared kind, which the field editor draws before the
 * option's label, at rest and in its picker. Any declared kind may fill the
 * slot (a design system with a swatch, a backdrop with a thumbnail), and
 * the field editor names none of them: it asks the point for the field it
 * draws.
 */
import { createElement, type ComponentType, type ReactNode } from "react";
import { declaredIdOf, type DeclaredOptions, type NodeId } from "@kb/model";
import { Point } from "@kb/plugin";
import { useContributions } from "./plugins";

/**
 * The preview of `kind`'s options: `Preview` is handed an option's declared
 * id, and draws nothing for one it cannot show (a thing nobody contributes
 * now).
 */
export interface OptionPreview {
  readonly kind: DeclaredOptions;
  readonly Preview: ComponentType<{ readonly id: string }>;
}

export const OptionPreviewPoint = Point<OptionPreview>()("ui.option-previews");

/**
 * How each option of `fieldId` is previewed, by its option node's id: null
 * for a field no contribution previews, and nothing for an id outside the
 * kind.
 */
export function useOptionPreview(fieldId: NodeId): ((optionId: NodeId) => ReactNode) | null {
  const preview = useContributions(OptionPreviewPoint).find(
    ({ value }) => value.kind.field === fieldId,
  )?.value;
  if (preview === undefined) return null;
  const { kind, Preview } = preview;
  return (optionId) => {
    const id = declaredIdOf(kind, optionId);
    return id === undefined ? null : createElement(Preview, { id });
  };
}
