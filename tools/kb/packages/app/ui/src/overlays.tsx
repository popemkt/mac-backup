/**
 * The shell's page overlays (`OverlayPoint`): each mounted once for the whole
 * page, in order. The shell names no overlay; a plugin contributes it, and
 * unloading the plugin unmounts it.
 */
import { useMemo } from "react";
import { OverlayPoint, useContributions } from "@kb/ui-sdk";

export function Overlays() {
  const contributed = useContributions(OverlayPoint);
  const overlays = useMemo(
    () => contributed.toSorted((a, b) => a.value.order - b.value.order),
    [contributed],
  );
  return overlays.map(({ id, value: { Component } }) => <Component key={id} />);
}
