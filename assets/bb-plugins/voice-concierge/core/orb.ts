// When the page shows the sphere small (docked) instead of large, so that more of the conversation fits.

/** How long a call runs before the sphere docks, when the conversation is still empty. */
export const DOCK_AFTER_MS = 4000;

export interface OrbInputs {
  /** The auto-minimize setting. */
  auto: boolean;
  /** The call's phase. */
  phase: "idle" | "connecting" | "live" | "ending";
  /** The concierge's thread has something in it beyond its brief. */
  hasContent: boolean;
  /** The call has been live for DOCK_AFTER_MS. */
  settled: boolean;
  /** The person's own choice from the toggle (or a tap on the sphere); it holds until the call's phase changes. */
  override: boolean | null;
  /** A mouse rests on the docked sphere: it opens up while it does. */
  hovered: boolean;
}

/**
 * Docked during a call once the conversation has content or the call has run a few seconds; large again when the
 * call is over (idle), on hover, or when the person says so.
 */
export function orbMinimized(o: OrbInputs): boolean {
  if (o.hovered) return false;
  if (o.override !== null) return o.override;
  if (!o.auto) return false;
  if (o.phase === "connecting") return o.hasContent;
  if (o.phase === "live") return o.hasContent || o.settled;
  return false;
}
