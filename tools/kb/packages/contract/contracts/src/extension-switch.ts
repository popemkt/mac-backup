/**
 * Whether a store has an optional family on (DESIGN.md → Extension families
 * → optional is a server-side load decision). The switch is a node like any
 * other: the family's own node, `sys.extension.<name>`, carrying the
 * checkbox field `sys.f.extension.enabled`. The registry loads an optional
 * family only while its node says so, and `kb.manifest` reports what the
 * registry loaded, so the page follows the store.
 *
 * Neither node is seeded. `extension.switch` writes them the first time a
 * person switches the family, so opening a store never writes them, and a
 * store without them has every optional family off.
 */
import { Schema } from "effect";
import {
  decodeNodeConfig,
  encodeNodeConfig,
  firstBool,
  oneOf,
  seededField,
  writeBool,
  type ConfigSlots,
  type KbNode,
} from "@kb/model";
import type { ExtensionDeclaration } from "./declaration.ts";

/** The checkbox field a family's node says it is on with. */
export const EXTENSION_ENABLED_FIELD = "sys.f.extension.enabled";

/** The node that holds a family's switch. */
export function extensionNodeId(name: string): string {
  return `sys.extension.${name}`;
}

/** How a store finds a node by id. */
export type NodeLookup = (id: string) => KbNode | undefined;

/** A store with no switch written: every optional family off. */
export const NO_SWITCHES: NodeLookup = () => undefined;

/** A family's node as a config: whether it is on, off when it does not say. */
const SWITCH: ConfigSlots<{ enabled: boolean }> = {
  enabled: oneOf({
    fields: [EXTENSION_ENABLED_FIELD],
    read: firstBool(EXTENSION_ENABLED_FIELD),
    write: writeBool(EXTENSION_ENABLED_FIELD),
    schema: Schema.Boolean,
    fallback: false,
  }),
};

/**
 * Whether the store `nodeOf` reads has the family on: an optional one by its
 * switch, any other always. A switch that does not read as a checkbox is
 * off, and `report` hears why.
 */
export function familyOn(
  declaration: ExtensionDeclaration,
  nodeOf: NodeLookup,
  report: (warning: string) => void,
): boolean {
  if (declaration.optional !== true) return true;
  const props = nodeOf(extensionNodeId(declaration.name))?.props;
  return decodeNodeConfig(SWITCH, props, report)("enabled");
}

/**
 * What switching a family to `on` writes, at `at`: the field, the first time
 * any family is switched, and the family's node, created under the family's
 * label or updated in place.
 */
export function switchWrites(
  family: Pick<ExtensionDeclaration, "name" | "label">,
  on: boolean,
  nodeOf: NodeLookup,
  at: string,
): KbNode[] {
  const field =
    nodeOf(EXTENSION_ENABLED_FIELD) === undefined
      ? [seededField(EXTENSION_ENABLED_FIELD, "enabled", "checkbox", at, { one: true })]
      : [];
  const id = extensionNodeId(family.name);
  const existing = nodeOf(id);
  const props = encodeNodeConfig(SWITCH, { enabled: on });
  const node: KbNode =
    existing === undefined
      ? { id, text: family.label, props, children: [], createdAt: at, updatedAt: at }
      : { ...existing, props: { ...existing.props, ...props }, updatedAt: at };
  return [...field, node];
}
