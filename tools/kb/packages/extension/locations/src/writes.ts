/**
 * The home store's locations as nodes, and what each location action writes
 * there: pure, over the home store's nodes, so every host plans a write the
 * same way and the handlers only commit it.
 *
 * A location is an ordinary node tagged `#kb-location` with one path. Its
 * place in the Locations list is its recency: opening or registering it
 * moves it first, and the store's commit settles the ranks (DESIGN.md →
 * Sibling ranks). Pinning is the home store's Pinned list, as for any node.
 */
import { SYSTEM_IDS, seededField, seededTag, type KbNode, type PropValue } from "@kb/model";
import type { NodeLookup } from "@kb/contracts";
import { LOCATION_IDS } from "./ids.ts";

/** One location node as the picker reads it, before anything is read from its path. */
export interface LocationEntry {
  readonly id: string;
  readonly label: string;
  /** Every path the node holds: one for a well-formed location. */
  readonly paths: readonly string[];
  readonly pinned: boolean;
}

const tagRef = (v: string): PropValue => ({ t: "ref", v });

function isLocation(node: KbNode): boolean {
  return (node.props[SYSTEM_IDS.typeField] ?? []).some(
    (value) => value.t === "ref" && value.v === LOCATION_IDS.tag,
  );
}

function pathsOf(node: KbNode): string[] {
  return (node.props[LOCATION_IDS.pathField] ?? []).flatMap((value) =>
    value.t === "str" ? [value.v] : [],
  );
}

/** The targets of the home store's Pinned list, in its order. */
function pinnedTargets(byId: ReadonlyMap<string, KbNode>): string[] {
  return (byId.get(SYSTEM_IDS.pinnedRoot)?.children ?? []).flatMap((refId) => {
    const target = byId.get(refId)?.props[SYSTEM_IDS.refTargetField]?.[0];
    return target?.t === "ref" ? [target.v] : [];
  });
}

/**
 * The home store's locations in the order a picker lists them: the pinned
 * ones first, in Pinned order, then the Locations list's order, then any
 * node tagged by hand that the list does not hold.
 */
export function locationEntries(nodes: readonly KbNode[]): LocationEntry[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const listed = byId.get(LOCATION_IDS.list)?.children ?? [];
  const tagged = nodes.filter(isLocation).map((node) => node.id);
  const pinned = new Set(pinnedTargets(byId));
  const order = [...new Set([...listed, ...tagged])].flatMap((id) => {
    const node = byId.get(id);
    return node !== undefined && isLocation(node) ? [node] : [];
  });
  const entry = (node: KbNode): LocationEntry => ({
    id: node.id,
    label: node.text,
    paths: pathsOf(node),
    pinned: pinned.has(node.id),
  });
  return [
    ...order.filter((node) => pinned.has(node.id)),
    ...order.filter((node) => !pinned.has(node.id)),
  ].map(entry);
}

/**
 * The tag, the path field and the Locations list, each written only where
 * the home store does not hold it, so they are minted once, by the first
 * register, as `extension.switch` mints a family's switch.
 */
export function locationMints(nodeOf: NodeLookup, at: string): KbNode[] {
  const minted: KbNode[] = [];
  if (nodeOf(LOCATION_IDS.pathField) === undefined)
    minted.push(seededField(LOCATION_IDS.pathField, "path", "text", at, { one: true }));
  if (nodeOf(LOCATION_IDS.tag) === undefined)
    minted.push(seededTag(LOCATION_IDS.tag, "kb-location", [LOCATION_IDS.pathField], at));
  if (nodeOf(LOCATION_IDS.list) === undefined)
    minted.push({
      id: LOCATION_IDS.list,
      text: "Locations",
      props: {},
      children: [],
      createdAt: at,
      updatedAt: at,
    });
  return minted;
}

function lastSegments(path: string, count: number): string {
  return path.split("/").filter(Boolean).slice(-count).join("/");
}

/**
 * The label a new location gets: its directory's name, or its parent's and
 * its own when another location already goes by that name.
 */
export function defaultLabel(path: string, taken: ReadonlySet<string>): string {
  const name = lastSegments(path, 1) || path;
  return taken.has(name) ? lastSegments(path, 2) || name : name;
}

/** The Locations list with `id` first, or null when it is first already. */
function rankedFirst(list: KbNode, id: string, at: string): KbNode | null {
  if (list.children[0] === id) return null;
  return {
    ...list,
    children: [id, ...list.children.filter((child) => child !== id)],
    updatedAt: at,
  };
}

export interface LocationWrite {
  /** The location the write is about. */
  readonly id: string;
  readonly upserts: readonly KbNode[];
  readonly deletes: readonly string[];
}

/**
 * What registering the root at `path` (canonical) writes: the mints a home
 * store without them needs, then the location, made under `id` with `label`
 * (else a default) unless a location already has that path, and the
 * location first in the list. Registering it again writes nothing; a label
 * given for a known location renames it.
 */
export function registerWrites(
  nodes: readonly KbNode[],
  request: { readonly path: string; readonly label?: string; readonly id: string },
  at: string,
): LocationWrite {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const mints = locationMints((id) => byId.get(id), at);
  const entries = locationEntries(nodes);
  const known = entries.find((entry) => entry.paths.includes(request.path));
  const upserts: KbNode[] = [...mints];
  let id = request.id;
  if (known === undefined) {
    const taken = new Set(entries.map((entry) => entry.label));
    upserts.push({
      id,
      text: request.label ?? defaultLabel(request.path, taken),
      props: {
        [SYSTEM_IDS.typeField]: [tagRef(LOCATION_IDS.tag)],
        [LOCATION_IDS.pathField]: [{ t: "str", v: request.path }],
      },
      children: [],
      createdAt: at,
      updatedAt: at,
    });
  } else {
    id = known.id;
    const node = byId.get(id);
    if (node !== undefined && request.label !== undefined && request.label !== node.text)
      upserts.push({ ...node, text: request.label, updatedAt: at });
  }
  const list = byId.get(LOCATION_IDS.list) ?? mints.find((node) => node.id === LOCATION_IDS.list);
  const ranked = list === undefined ? null : rankedFirst(list, id, at);
  if (ranked !== null) {
    const minted = upserts.findIndex((node) => node.id === LOCATION_IDS.list);
    if (minted === -1) upserts.push(ranked);
    else upserts[minted] = ranked;
  }
  return { id, upserts, deletes: [] };
}

/**
 * What forgetting the location `id` writes: the node deleted, with the list
 * entry and any Pinned reference to it, or null when `id` is no location.
 * The directory it names is never touched.
 */
export function forgetWrites(
  nodes: readonly KbNode[],
  id: string,
  at: string,
): LocationWrite | null {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const node = byId.get(id);
  if (node === undefined || !isLocation(node)) return null;
  const pins = (byId.get(SYSTEM_IDS.pinnedRoot)?.children ?? []).filter((refId) => {
    const target = byId.get(refId)?.props[SYSTEM_IDS.refTargetField]?.[0];
    return target?.t === "ref" && target.v === id;
  });
  const gone = new Set([id, ...pins]);
  const upserts = [LOCATION_IDS.list, SYSTEM_IDS.pinnedRoot].flatMap((parentId) => {
    const parent = byId.get(parentId);
    if (parent === undefined || !parent.children.some((child) => gone.has(child))) return [];
    return [
      { ...parent, children: parent.children.filter((child) => !gone.has(child)), updatedAt: at },
    ];
  });
  return { id, upserts, deletes: [...gone] };
}
