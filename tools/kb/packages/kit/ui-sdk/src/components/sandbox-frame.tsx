/**
 * One sandbox frame (DESIGN.md → Sandbox → The frame): an iframe sandboxed
 * with `allow-scripts` alone, its document the kb server's `/sandbox`, and
 * the page's end of the bridge (`lib/sandbox-host`) bound to it for as long
 * as it is mounted. A new run is a new frame: the caller keys it, so no
 * realm outlives the code it ran.
 */
import { useEffect, useRef } from "react";
import { DATA_EVENT, SANDBOX_FRAME_PATH, SANDBOX_IFRAME_FLAGS } from "@kb/sandbox";
import { browserHost } from "../host";
import type { HostedFrame, SandboxEvents, SandboxPorts, SandboxRun } from "../sandbox";
import type { ViewEvents } from "../view-scripts";

/** How long the graph must be still before the frame hears that it changed. */
const CHANGE_SETTLE_MS = 150;

export function SandboxFrame({
  run,
  ports,
  events,
  generation,
  title,
  listen,
  className = "min-h-0 w-full flex-1 border-0 bg-transparent",
}: {
  /** What the frame runs; read once, when it mounts. */
  readonly run: SandboxRun;
  readonly ports: SandboxPorts;
  readonly events: SandboxEvents;
  /** The graph's generation: a new one tells the code the graph changed. */
  readonly generation: number;
  readonly title: string;
  /** Where the run's view emits its own events, handed on to the run (`ViewEvents.listen`). */
  readonly listen?: ViewEvents["listen"];
  readonly className?: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const hosted = useRef<HostedFrame | null>(null);
  // Read once: the caller keys the frame by everything a run is.
  const first = useRef({ run, ports, events, listen });

  useEffect(() => {
    const element = frame.current;
    if (element === null) return undefined;
    const { run: initial, ports: given, events: told, listen: heard } = first.current;
    const host = browserHost().sandbox.hostFrame(element, initial, given, told);
    hosted.current = host;
    const unlisten = heard?.((event) => host.event(event));
    return () => {
      unlisten?.();
      host.dispose();
      hosted.current = null;
    };
  }, []);

  // The run starts on the graph as it is; only a later generation is a change.
  const startedAt = useRef(generation);
  useEffect(() => {
    if (generation === startedAt.current) return undefined;
    const timer = window.setTimeout(
      () => hosted.current?.event({ type: DATA_EVENT, target: null }),
      CHANGE_SETTLE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [generation]);

  return (
    <iframe
      ref={frame}
      src={SANDBOX_FRAME_PATH}
      sandbox={SANDBOX_IFRAME_FLAGS}
      title={title}
      referrerPolicy="no-referrer"
      className={className}
      data-sandbox-frame={run.input.engine}
    />
  );
}
