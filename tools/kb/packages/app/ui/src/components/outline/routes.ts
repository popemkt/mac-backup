import type { NoParams } from "@/lib/plugins";

/** The outline owns `/`; which node it is zoomed to lives in the store, not the path. */
export function matchOutline(path: string): NoParams | null {
  return path === "/" ? {} : null;
}
