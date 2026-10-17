/**
 * Which backdrop a page head paints, how strong and which way it faces
 * (DESIGN-UI.md → Page-head backdrops): three settings of core's node
 * (`sys.extension.core`), since the slot is core's and names no backdrop,
 * and the same three fields on a node, for that node's page. Each is a ref
 * to one of its field's children: the backdrops are the options the seed
 * fold derives from the families' declarations, as it derives views'.
 */
import {
  declaredChoice,
  declaredOptionId,
  type DeclaredOptions,
  type SeedOption,
} from "./declared-option.ts";
import { SYSTEM_IDS, type KbNode, type NodeId } from "./model.ts";
import { firstRef } from "./node-config.ts";

/**
 * A backdrop as a declaration names it: a declared option, whose id its
 * contribution answers to in the page's backdrop point.
 */
export type SeedBackdrop = SeedOption;

/** The backdrops' options: the children of `sys.f.backdrop`. */
export const BACKDROP_OPTIONS: DeclaredOptions = {
  field: SYSTEM_IDS.backdropField,
  prefix: "sys.backdrop.",
};

/** The option node that names the backdrop `id` under `sys.f.backdrop`. */
export function backdropOptionId(id: string): NodeId {
  return declaredOptionId(BACKDROP_OPTIONS, id);
}

export const BACKDROP_STRENGTHS = ["subtle", "soft", "vivid"] as const;
export type BackdropStrength = (typeof BACKDROP_STRENGTHS)[number];
export const BACKDROP_DIRECTIONS = ["down", "up"] as const;
export type BackdropDirection = (typeof BACKDROP_DIRECTIONS)[number];

/**
 * The option nodes `sys.f.backdrop.strength` and `sys.f.backdrop.direction`
 * refer to: those fields' children (DESIGN.md → Kinds, roles and options).
 */
export const BACKDROP_STRENGTH_OPTION_IDS: Readonly<Record<BackdropStrength, NodeId>> = {
  subtle: "sys.backdrop-strength.subtle",
  soft: "sys.backdrop-strength.soft",
  vivid: "sys.backdrop-strength.vivid",
};
export const BACKDROP_DIRECTION_OPTION_IDS: Readonly<Record<BackdropDirection, NodeId>> = {
  down: "sys.backdrop-direction.down",
  up: "sys.backdrop-direction.up",
};

/** A page head's backdrop, as its settings say. */
export interface BackdropChoice {
  /** A contributed backdrop's id; null, the first contributed. */
  readonly backdrop: string | null;
  readonly strength: BackdropStrength;
  readonly direction: BackdropDirection;
}

type Props = KbNode["props"];

function optionOf<V extends string>(
  values: readonly V[],
  ids: Readonly<Record<V, NodeId>>,
  ref: NodeId | undefined,
): V | undefined {
  return values.find((value) => ids[value] === ref);
}

/**
 * The backdrop `sources` choose, nearest first (the page's own node, then
 * core's), among the backdrops contributed (`contributed`, by id): each
 * setting is the first one that holds a value it reads as one of its
 * options, and the first contributed backdrop, `subtle` and `down` where
 * none does. A backdrop nobody contributes now (its plugin unloaded, its
 * declaration gone) is no option, so it falls through as an unknown
 * strength does.
 */
export function backdropChoice(
  sources: readonly (Props | undefined)[],
  contributed: readonly string[],
): BackdropChoice {
  const held = sources.filter((props): props is Props => props !== undefined);
  const first = <V>(read: (props: Props) => V | undefined): V | undefined =>
    held.map(read).find((value) => value !== undefined);
  return {
    backdrop: declaredChoice(BACKDROP_OPTIONS, held, contributed),
    strength:
      first((props) =>
        optionOf(
          BACKDROP_STRENGTHS,
          BACKDROP_STRENGTH_OPTION_IDS,
          firstRef(SYSTEM_IDS.backdropStrengthField)(props),
        ),
      ) ?? "subtle",
    direction:
      first((props) =>
        optionOf(
          BACKDROP_DIRECTIONS,
          BACKDROP_DIRECTION_OPTION_IDS,
          firstRef(SYSTEM_IDS.backdropDirectionField)(props),
        ),
      ) ?? "down",
  };
}
