/**
 * A declared option (DESIGN.md → Extension families → the seed is the bundled
 * fold): a thing a family names on its declaration and its page plugin
 * contributes, chosen by a ref to the option node the seed fold derives for
 * it under the field that chooses it, as a view type is chosen by its option
 * under `sys.views`. Page-head backdrops are one kind and design systems
 * another; every kind is read the same way, so a stale choice falls through
 * the same way for each.
 */
import { firstRef } from "./node-config.ts";
import type { KbNode, NodeId } from "./model.ts";

/**
 * A declared thing as its declaration names it: its id, `<family>.<local
 * id>` (a key of core's has no family part), the id its contribution answers
 * to, and the label its option node carries. The option is derived from it
 * and never declared a second time.
 */
export interface SeedOption {
  readonly id: string;
  readonly label: string;
}

/** One kind of declared option: the field whose children its options are, and the prefix their ids carry. */
export interface DeclaredOptions {
  readonly field: NodeId;
  readonly prefix: string;
}

/** The option node that names the declared thing `id` among `kind`'s options. */
export function declaredOptionId(kind: DeclaredOptions, id: string): NodeId {
  return `${kind.prefix}${id}`;
}

/** The declared id the option node `optionId` names among `kind`'s; none for any other id. */
function declaredIdOf(kind: DeclaredOptions, optionId: NodeId | undefined): string | undefined {
  return optionId?.startsWith(kind.prefix) === true
    ? optionId.slice(kind.prefix.length)
    : undefined;
}

type Props = KbNode["props"];

/**
 * The declared thing `sources` choose by `kind`'s field, nearest first: the
 * first source holding a ref to the option of one that is contributed now
 * (`contributed`, by id); null where none does. A choice nobody contributes
 * (its plugin unloaded, its declaration gone) is no choice, so it falls
 * through to the next source.
 */
export function declaredChoice(
  kind: DeclaredOptions,
  sources: readonly (Props | undefined)[],
  contributed: readonly string[],
): string | null {
  for (const props of sources) {
    if (props === undefined) continue;
    const id = declaredIdOf(kind, firstRef(kind.field)(props));
    if (id !== undefined && contributed.includes(id)) return id;
  }
  return null;
}
