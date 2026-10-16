import { OutlineEditor } from "./outline-editor";
import { cn, usePrefs } from "@kb/ui-sdk";

/** The one content column: centered 768px or fluid, per the width pref. */
export function OutlineColumn({ root }: { readonly root?: string | undefined }) {
  const width = usePrefs((prefs) => prefs.width);
  return (
    <div
      className={cn("kb-shell w-full", width === "centered" ? "mx-auto max-w-3xl px-4" : "px-8")}
    >
      <OutlineEditor root={root} />
    </div>
  );
}
