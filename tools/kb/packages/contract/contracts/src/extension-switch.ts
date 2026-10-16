/**
 * Whether a store has an optional family on (DESIGN.md → Extension families
 * → optional is a server-side load decision). The switch is a node like any
 * other: the family's own node, `sys.extension.<name>`, carrying the
 * checkbox field `sys.f.extension.enabled`. The registry loads an optional
 * family only while its node says so, and `kb.manifest` reports what the
 * registry loaded, so the page follows the store.
 *
 * The node and the field are seeded (the fold derives every extension's
 * node from its declaration), and the node holds no switch until
 * `extension.switch` writes it the first time a person switches the family.
 * So a store nobody has switched has every optional family as its
 * declaration has it by default.
 */
import { Schema } from "effect";
import {
  SYSTEM_IDS,
  decodeNodeConfig,
  encodeNodeConfig,
  extensionNodeId,
  firstBool,
  oneOf,
  writeBool,
  type ConfigSlots,
  type KbNode,
} from "@kb/model";
import type { ExtensionDeclaration } from "./declaration.ts";

/** How a store finds a node by id. */
export type NodeLookup = (id: string) => KbNode | undefined;

/** A store with no switch written: every optional family as it is by default. */
export const NO_SWITCHES: NodeLookup = () => undefined;

const ENABLED = SYSTEM_IDS.extensionEnabledField;

/** A family's node as a config: whether it is on, `byDefault` when it does not say. */
function switchSlots(byDefault: boolean): ConfigSlots<{ enabled: boolean }> {
  return {
    enabled: oneOf({
      fields: [ENABLED],
      read: firstBool(ENABLED),
      write: writeBool(ENABLED),
      schema: Schema.Boolean,
      fallback: byDefault,
    }),
  };
}

/**
 * Whether the store `nodeOf` reads has the family on: an optional one by its
 * switch, or by its declared default where none is written; a required one
 * always, whatever its node says. A switch that does not read as a checkbox
 * reads as the default, and `report` hears why.
 */
export function familyOn(
  declaration: ExtensionDeclaration,
  nodeOf: NodeLookup,
  report: (warning: string) => void,
): boolean {
  if (declaration.optional === undefined) return true;
  const props = nodeOf(extensionNodeId(declaration.name))?.props;
  const slots = switchSlots(declaration.optional.byDefault === "on");
  return decodeNodeConfig(slots, props, report)("enabled");
}

/**
 * What switching a family to `on` writes, at `at`: its node, with the switch
 * set and nothing else touched, or created under the family's label where
 * the store does not hold it.
 */
export function switchWrites(
  family: Pick<ExtensionDeclaration, "name" | "label">,
  on: boolean,
  nodeOf: NodeLookup,
  at: string,
): KbNode[] {
  const id = extensionNodeId(family.name);
  const existing = nodeOf(id);
  // A written switch holds its value whatever the default, which only a read consults.
  const props = encodeNodeConfig(switchSlots(on), { enabled: on });
  const node: KbNode =
    existing === undefined
      ? { id, text: family.label, props, children: [], createdAt: at, updatedAt: at }
      : { ...existing, props: { ...existing.props, ...props }, updatedAt: at };
  return [node];
}
