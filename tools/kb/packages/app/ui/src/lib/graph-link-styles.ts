/**
 * What each link style means (`lens.link-style`, one option set for every
 * renderer that draws links), stated once as two parts: the link's **shape**,
 * straight or curved, and whether it **flows** — dashes drifting source to
 * target, one passing in the ambient period. Flow is drawn on curves.
 *
 * Every renderer reads the part it can draw: the shape everywhere, the flow
 * only where a dash can move (the 3D graph). A 2D graph given flow draws its
 * shape, still, and the settings panel says so.
 */
import type { LensLinkStyle } from "@/lib/graph-lens";

export interface LinkStyleParts {
  readonly curved: boolean;
  readonly flowing: boolean;
}

/** Keyed by the option set, so a new style fails the build until it is given a meaning. */
export const LINK_STYLES: Readonly<Record<LensLinkStyle, LinkStyleParts>> = {
  straight: { curved: false, flowing: false },
  curved: { curved: true, flowing: false },
  flow: { curved: true, flowing: true },
};
