import { BACKDROP_OPACITY, tagColorAlpha } from "@kb/ui-sdk";
import { usePrefsStore } from "@/stores/prefs.store";
import { UnicornBackdrop } from "./unicorn-backdrop";
import "./header-backdrop.css";

/**
 * The ambient wash behind a page's head: a soft radial tint of `color`,
 * weakened through the tag-color owner so any CSS colour works. The zoomed
 * header paints its tag's colour; home, which has no tag, paints the accent.
 */
export function HeaderBackdrop({ color }: { color: string }) {
  const backdrop = usePrefsStore((s) => s.headerBackdrop);
  const strength = usePrefsStore((s) => s.backdropStrength);
  const direction = usePrefsStore((s) => s.backdropDirection);
  return (
    <div
      className="kb-header-backdrop pointer-events-none"
      data-backdrop={backdrop}
      data-direction={direction}
      style={{ opacity: BACKDROP_OPACITY[strength] }}
      aria-hidden="true"
      data-header-wash="true"
    >
      <div
        className="kb-header-tint absolute inset-y-0"
        style={{
          left: 0,
          right: 0,
          background:
            `radial-gradient(ellipse 60% 70% at 50% 35%, ` +
            `${tagColorAlpha(color, 24)} 0%, ` +
            `${tagColorAlpha(color, 10)} 40%, transparent 80%)`,
        }}
      />
      {backdrop === "unicorn" && <UnicornBackdrop />}
    </div>
  );
}
