/**
 * How the Light study's lamps come up on arrival: the key first, the fill
 * and rim a beat behind, each a place in the entrance's order (0 first, 1
 * last). The fill never goes fully dark, so the room is never black.
 */
import type { Entrance } from "@/components/lab/kit/entrance";

/** Places in the entrance's order: the fill starts about a quarter of the way in, the rim just under half. */
export const LAMP_ORDER = { key: 0, fill: 0.45, rim: 0.8 } as const;

/** The fill's floor while it waits: a little shadow colour from the start. */
const FILL_FLOOR = 0.15;

/** Each lamp's share of its full intensity now, 0–1. */
export function lampLevels(entrance: Entrance): { key: number; fill: number; rim: number } {
  return {
    key: entrance.arrived(LAMP_ORDER.key),
    fill: FILL_FLOOR + (1 - FILL_FLOOR) * entrance.arrived(LAMP_ORDER.fill),
    rim: entrance.arrived(LAMP_ORDER.rim),
  };
}
