/**
 * The frozen ids of the locations family. What it keeps in a person's home
 * store is not seeded: the fold seeds every store, and a `#kb-location` tag
 * in this repository's store would invite tagging nodes no location action
 * reads. The first register mints them in the home store (`locationMints`).
 * Only its ⌘K command is seeded, since a command ⌘K offers is a node, in
 * every store the page opens.
 *
 * The list is not `sys.`-prefixed, for the reason the Pinned and Views lists
 * are not: ordering it is a write of its children, which a person makes by
 * dragging in the home store's outline, and the `sys.*` guard would refuse
 * it.
 */
export const LOCATION_IDS = {
  /** `#kb-location`: a node that is one of the person's kb roots. */
  tag: "sys.tag.kb-location",
  /** The root's absolute, canonical path (text, one value). */
  pathField: "sys.f.location.path",
  /** The Locations list: its children are the locations, most recently opened first. */
  list: "locations",
  /** ⌘K "Open location…", a `sys.command` node the seed declares. */
  openCommand: "sys.cmd.location.open",
} as const;
