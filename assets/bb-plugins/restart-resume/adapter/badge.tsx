// The thread header badge: a compact pill saying why this thread's last turn stopped, with the
// details (reason, who, when, auto-resume) as its tooltip and, on click or tap, in a toast.
// Renders nothing while the thread has no standing stop.
import { type CSSProperties, useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
  experimental_Icon as Icon,
  experimental_useSidebarThreads,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import { present, type Tone } from "../core/stops.ts";
import { stopStore } from "./store.ts";
import { useFetchStops } from "./sync.tsx";

const TONE_COLOR: Record<Tone, string> = {
  default: "var(--muted-foreground)",
  error: "var(--destructive-text, var(--destructive))",
  running: "var(--foreground)",
  success: "var(--success)",
};

const pill = (tone: Tone): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  height: 24,
  maxWidth: 260,
  padding: "0 8px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "transparent",
  color: TONE_COLOR[tone],
  fontSize: 12,
  lineHeight: "16px",
  whiteSpace: "nowrap",
  cursor: "pointer",
});

export function StopBadge({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const view = useSyncExternalStore(stopStore.subscribe, () => stopStore.get(threadId));
  const { threads } = experimental_useSidebarThreads();
  const status = threads.find((thread) => thread.id === threadId)?.status ?? "unknown";
  const fetchStops = useFetchStops();
  // A thread outside the sidebar's list (hidden, or not loaded yet): ask for it directly.
  useEffect(() => {
    if (stopStore.get(threadId) === undefined) {
      fetchStops([threadId]).catch((error: unknown) => console.warn("[restart-resume] stop lookup failed", error));
    }
  }, [threadId, fetchStops]);

  if (!view) return null;
  const shown = present(view, status, Date.now());
  return (
    <button
      type="button"
      aria-label={shown.label}
      title={shown.details.join("\n")}
      style={pill(shown.tone)}
      onClick={() => toast(shown.short, { description: shown.details.slice(1).join("\n") })}
    >
      <Icon name={shown.icon} fallback="AlertCircle" aria-hidden style={{ width: 14, height: 14, flexShrink: 0 }} />
      {isCompactViewport ? null : <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{shown.short}</span>}
    </button>
  );
}
