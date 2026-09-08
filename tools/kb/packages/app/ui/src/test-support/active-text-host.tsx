/**
 * A mounted text host for whatever row the store says is active.
 *
 * `activateNode` arms a 250 ms wall-clock fallback (`fallBackFromMissingHost`)
 * that drops the active row when no text host has registered for it, so an
 * orphaned active id cannot eat keyboard input. In the app that timer never
 * fires: every visible row mounts a `NodeTextHost`, which registers itself the
 * moment it becomes active.
 *
 * A suite that drives the keymap directly renders one editor, not an outline —
 * so a chord that crosses to another row leaves that row hostless, the timer
 * fires, and `activeNodeId` goes null. On an idle machine the assertion wins
 * the race; under load it does not. Mounting this beside the editor under test
 * restores the invariant the store is written against, instead of racing its
 * timer or widening the test's own budget past 250 ms.
 *
 * It registers by the same `useLayoutEffect` shape as `NodeTextHost`, so the
 * registration lands in the React commit the test's `act` already awaits.
 */
import { useLayoutEffect } from "react";
import { useOutlineStore } from "@/stores/outline.store";

export function ActiveTextHost(): null {
  const activeInstanceKey = useOutlineStore((s) => s.activeInstanceKey);

  useLayoutEffect(() => {
    if (activeInstanceKey === null) return undefined;
    const registry = useOutlineStore.getState();
    registry.registerTextHost(activeInstanceKey);
    return () => registry.unregisterTextHost(activeInstanceKey);
  }, [activeInstanceKey]);

  return null;
}
