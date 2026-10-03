import { MAIN_OUTLINE_HOST, hostOfInstance } from "@/lib/instance-key";
import type { SlotChain } from "@/lib/view-key";

/**
 * An outline on screen, as the keyboard walk needs it: the node it is rooted
 * at (null for the outline's zoom, which the store owns) and the slots around
 * its root frame, as its host renders them.
 */
interface OutlineHost {
  readonly root: string | null;
  readonly chain: SlotChain;
}

/** The zoomed outline, before any host has said where it sits. */
const UNMOUNTED_MAIN: OutlineHost = { root: null, chain: [] };

/**
 * The outlines on screen, by host id (`outlineHostOfPane`): each mounted
 * outline says where it is rooted and what slots surround it, so the store's
 * walk of a row's outline starts where that outline's slot does. A port, like
 * `frame-views`, so the store reads no React. The main host is always there:
 * the zoom is the store's whether or not its outline is mounted.
 */
const hosts = new Map<string, OutlineHost>();

/** Say where host `id` is rooted, or, with null, that it left the screen. */
export function setOutlineHost(id: string, host: OutlineHost | null): void {
  if (host === null) hosts.delete(id);
  else hosts.set(id, host);
}

/** Where host `id` is rooted, or undefined when no outline is mounted under it. */
export function outlineHostOf(id: string): OutlineHost | undefined {
  return hosts.get(id) ?? (id === MAIN_OUTLINE_HOST ? UNMOUNTED_MAIN : undefined);
}

/**
 * The outline host whose rows include `instanceKey`: the host it is keyed
 * under when an outline is mounted there, else the main pane's (a projected
 * row's key names its query, not its host).
 */
export function outlineHostOfInstance(instanceKey: string | null): string {
  if (instanceKey === null) return MAIN_OUTLINE_HOST;
  const host = hostOfInstance(instanceKey);
  return outlineHostOf(host) === undefined ? MAIN_OUTLINE_HOST : host;
}
