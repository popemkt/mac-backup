/**
 * Where a view mounts its scripts (`view-scripts.ts`): the host the family
 * that keeps scripts provides, or nothing while none does.
 */
import { Suspense, createElement } from "react";
import { useService } from "../lib/plugins";
import { ScriptHostService, type ScriptHostProps } from "../view-scripts";

/** The scripts of `subjects`, run for `view`; nothing while no family provides a host. */
export function ViewScripts(props: ScriptHostProps) {
  const Host = useService(ScriptHostService);
  // The host may load in a chunk of its own; the view never waits on it.
  return Host === undefined
    ? null
    : createElement(Suspense, { fallback: null }, createElement(Host, props));
}
