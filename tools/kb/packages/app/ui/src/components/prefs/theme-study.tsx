import { useLayoutEffect } from "react";
import { ThemeIcon } from "@/components/ui/theme-icon";
import { applyPrefs, usePrefsStore } from "@/stores/prefs.store";

export function ThemeStudy() {
  useLayoutEffect(() => applyPrefs(usePrefsStore.getState()), []);
  const theme = usePrefsStore((s) => s.theme);
  const setTheme = usePrefsStore((s) => s.setTheme);
  return (
    <div className="min-h-[480px] bg-background p-8 text-foreground">
      <div className="mx-auto max-w-xl">
        <div className="mb-10 flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              kb · day and night
            </p>
            <h1 className="mt-2 text-xl font-medium">Same thoughts. A different light.</h1>
          </div>
          <button
            type="button"
            className="flex shrink-0 items-center gap-2 rounded-full border border-border px-4 py-2 text-[12px] hover:bg-muted"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            <ThemeIcon theme={theme} size={17} />
            {theme === "dark" ? "Daylight" : "Nightfall"}
          </button>
        </div>
        <div className="rounded-2xl border border-border bg-card p-8">
          <svg viewBox="0 0 480 160" className="mb-7 w-full" aria-hidden="true">
            <path
              d="M70 90L200 38L320 105L420 45M70 90L320 105"
              fill="none"
              stroke="var(--border)"
              strokeWidth="1.5"
            />
            <circle cx="70" cy="90" r="9" fill="var(--primary)" />
            <circle cx="200" cy="38" r="6" fill="var(--canvas-color-4)" />
            <circle cx="320" cy="105" r="12" fill="var(--primary)" />
            <circle cx="420" cy="45" r="7" fill="var(--canvas-color-5)" />
          </svg>
          <h2 className="text-base font-medium">Everything is connected.</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            A thought, a person, a question. The relationships stay where you left them.
          </p>
        </div>
      </div>
    </div>
  );
}
