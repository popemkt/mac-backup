/**
 * The scripts a view runs (DESIGN.md → Sandbox → Scripts): a view that
 * declares events in its key (`ViewKey.events`) emits them on a channel
 * and mounts {@link ViewScripts} for the nodes it shows; the family that
 * keeps scripts (code) provides the host that finds the scripts those
 * nodes name and runs them, through this service. A view that draws its
 * things somewhere also tells where ({@link ViewLayout}), so what a script
 * draws can stand on them. The view names no script, field or runner; the
 * host names no view.
 */
import type { ComponentType } from "react";
import { Service } from "@kb/plugin";
import type { KbEvent, SandboxAnchors } from "@kb/sandbox";
import type { ViewKey } from "@kb/views";

/** The events a view tells the scripts run for it, as it emits them. */
export interface ViewEvents {
  readonly emit: (event: KbEvent) => void;
  /** Hear every event emitted from now; the returned function stops. */
  readonly listen: (listener: (event: KbEvent) => void) => () => void;
}

/** A view's event channel: one per mounted view, created once. */
export function createViewEvents(): ViewEvents {
  const listeners = new Set<(event: KbEvent) => void>();
  return {
    emit: (event) => {
      for (const listener of listeners) listener(event);
    },
    listen: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** How a view lies on screen now: where it draws each of its things (`SandboxAnchors`). */
export interface ViewLayoutState {
  readonly anchors: SandboxAnchors;
}

/**
 * How a view lies on screen now, as it last said: a state, not a stream, so
 * a script that starts later stands its drawing on its things at once.
 */
export interface ViewLayout {
  readonly set: (layout: ViewLayoutState) => void;
  /** Hear how it lies now, then every change; the returned function stops. */
  readonly listen: (listener: (layout: ViewLayoutState) => void) => () => void;
}

/** A view's layout: one per mounted view, created once, knowing nothing until it is told. */
export function createViewLayout(): ViewLayout {
  const listeners = new Set<(layout: ViewLayoutState) => void>();
  let now: ViewLayoutState = { anchors: {} };
  return {
    set: (layout) => {
      now = layout;
      for (const listener of listeners) listener(layout);
    },
    listen: (listener) => {
      listeners.add(listener);
      listener(now);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * What a script host runs: the scripts the `subjects` name, for `view`,
 * hearing `events`, their drawings over the view standing on its `layout`.
 */
export interface ScriptHostProps {
  /** The nodes the view shows whose scripts run, each script with its node as `kb.subject`. */
  readonly subjects: readonly string[];
  readonly view: ViewKey<unknown>;
  readonly events: ViewEvents;
  readonly layout: ViewLayout;
}

/** The host that runs a view's scripts, as the family that keeps scripts provides it. */
export const ScriptHostService = Service<ComponentType<ScriptHostProps>>()("ui.script-host");
