import { OutlineEditor } from "@/components/outline/outline-editor";
import { cn } from "@/lib/cn";
import { usePrefsStore } from "@/stores/prefs.store";

/** The one content column: centered 768px or fluid, per the width pref. */
export function OutlineColumn() {
  const width = usePrefsStore((s) => s.width);
  return (
    <div
      className={cn("kb-shell w-full", width === "centered" ? "mx-auto max-w-3xl px-4" : "px-8")}
    >
      <OutlineEditor />
    </div>
  );
}
