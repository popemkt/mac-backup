import type { FrameViewKey } from "@/lib/view-config";
import type { FamilyView } from "@/lib/view-key";

type FrameViewSource = () => readonly FamilyView<FrameViewKey>[];

const NONE: FrameViewSource = () => [];

/**
 * Which frame views are provided: a port the outline plugin wires to
 * `ViewPoint` while it is loaded, so the store's row walk and the command
 * registry see the same views the outline renders without the store reading
 * the plugin kernel. While nothing is wired, no frame view is provided.
 */
let source: FrameViewSource = NONE;

export function provideFrameViews(next: FrameViewSource): void {
  source = next;
}

/** Unwire `wired`, if it is still what the port reads. */
export function withdrawFrameViews(wired: FrameViewSource): void {
  if (source === wired) source = NONE;
}

export function providedFrameViews(): readonly FamilyView<FrameViewKey>[] {
  return source();
}
