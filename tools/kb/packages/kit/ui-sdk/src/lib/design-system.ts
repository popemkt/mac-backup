/**
 * Which design system paints the page, read and written as core's setting
 * (DESIGN-UI.md → Design tokens → Design systems): the one reading of the
 * choice the shell's painter, Preferences and the switch command share, and
 * the one write that makes it.
 */
import {
  designSystemChoice,
  designSystemOptionId,
  extensionNodeId,
  SYSTEM_IDS,
  type KbNode,
} from "@kb/model";
import type { Contribution } from "@kb/plugin";
import type { PageWrites } from "./page-writes";
import { chosenDeclared, type DesignSystem } from "./plugins";

const CORE = extensionNodeId("core");

/**
 * The design system core's settings (`core`, its node's props) choose among
 * `contributed`; the first contributed, core's default, where they choose
 * none or one nobody contributes. Null only when nothing is contributed.
 */
export function shownDesignSystem(
  contributed: readonly Contribution<DesignSystem>[],
  core: KbNode["props"] | undefined,
): Contribution<DesignSystem> | null {
  const chosen = designSystemChoice(
    [core],
    contributed.map(({ value }) => value.key.id),
  );
  return chosenDeclared(contributed, chosen);
}

/** Choose the design system `id` for the page: core's setting, written as any field is. */
export function chooseDesignSystem(writes: PageWrites, id: string): Promise<void> {
  return writes.updateProp(CORE, SYSTEM_IDS.designSystemField, {
    t: "ref",
    v: designSystemOptionId(id),
  });
}
