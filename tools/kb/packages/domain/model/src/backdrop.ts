/**
 * Which backdrop a page head paints, how strong and which way it faces
 * (DESIGN-UI.md → Page-head backdrops): three settings of core's node
 * (`sys.extension.core`), since the slot is core's and names no backdrop,
 * and the same three fields on a node, for that node's page. Each is a ref
 * to one of its field's children: the backdrops are the options the seed
 * fold derives from the families' declarations, as it derives views'.
 */
import { SYSTEM_IDS, type KbNode, type NodeId } from "./model.ts";
import { firstRef } from "./node-config.ts";

/**
 * A backdrop as a declaration names it: its id, `<family>.<local id>`, the
 * id its contribution answers to in the page's backdrop point, and the
 * label its option node carries. The option is derived from it and never
 * declared a second time.
 */
export interface SeedBackdrop {
  readonly id: string;
  readonly label: string;
}

const BACKDROP_OPTION_PREFIX = "sys.backdrop.";

/** The option node that names the backdrop `id` under `sys.f.backdrop`. */
export function backdropOptionId(id: string): NodeId {
  return `${BACKDROP_OPTION_PREFIX}${id}`;
}

/** The backdrop id the option node `optionId` names; none for any other id. */
function backdropIdOf(optionId: NodeId | undefined): string | undefined {
  return optionId?.startsWith(BACKDROP_OPTION_PREFIX) === true
    ? optionId.slice(BACKDROP_OPTION_PREFIX.length)
    : undefined;
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
  /** A declared backdrop's id; null, the first contributed. */
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
 * core's): each setting is the first one that holds a value it reads, and
 * the first contributed backdrop, `subtle` and `down` where none does.
 */
export function backdropChoice(sources: readonly (Props | undefined)[]): BackdropChoice {
  const held = sources.filter((props): props is Props => props !== undefined);
  const first = <V>(read: (props: Props) => V | undefined): V | undefined =>
    held.map(read).find((value) => value !== undefined);
  const backdrop = first((props) => backdropIdOf(firstRef(SYSTEM_IDS.backdropField)(props)));
  return {
    backdrop: backdrop ?? null,
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
