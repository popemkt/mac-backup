/**
 * A registered text host for whatever row the store says is active.
 *
 * `activateNode` arms a 250 ms wall-clock `fallBackFromMissingHost`, which
 * drops the active row when no text host has registered for it, so an orphaned
 * active id cannot eat keyboard input. In the app that timer never fires: every
 * visible row mounts a `NodeTextHost`, and it registers the moment its row
 * becomes active.
 *
 * A suite that drives the store or the keymap directly renders one row, or no
 * row at all — so a chord or an `activateNode` that lands on a different row
 * leaves that row hostless, the timer fires, and `activeNodeId` goes null. On
 * an idle machine the assertion wins the race; under load it does not. This
 * restores the invariant the store is written against, instead of racing the
 * timer or widening the test's own budget past 250 ms.
 *
 * It follows the store rather than React: the registry only asks whether the
 * key is in `mountedTextHosts`, and a subscription registers in the same tick
 * as the activation instead of one commit later. That also keeps it off the
 * suite's own React root, which a `root.render` would otherwise displace.
 */
import { useOutlineStore } from "@/stores/outline.store";

/**
 * Start following the active row. Call in `beforeEach`; call the returned
 * function in `afterEach`.
 */
export function mountActiveTextHost(): () => void {
  let registered: string | null = null;

  function follow(next: string | null): void {
    if (next === registered) return;
    const registry = useOutlineStore.getState();
    if (registered !== null) registry.unregisterTextHost(registered);
    registered = next;
    if (next !== null) registry.registerTextHost(next);
  }

  follow(useOutlineStore.getState().activeInstanceKey);
  const unsubscribe = useOutlineStore.subscribe((s) => follow(s.activeInstanceKey));

  return () => {
    unsubscribe();
    follow(null);
  };
}
