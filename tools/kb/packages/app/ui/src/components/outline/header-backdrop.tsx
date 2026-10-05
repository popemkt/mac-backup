import { tagColorAlpha } from "@kb/ui-sdk";
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
  // The wash spreads 60px past the head on each side, which inside the main
  // region's `overflow-x: auto` is 60px of sideways scroll. So it paints in a
  // box of the head's own width that clips horizontally (`clip`, which, unlike
  // `hidden`, starts no scroll container and leaves the vertical spill alone).
  // Only the wash is clipped, never the editor: a wide table must still scroll.
  return (
    <div
      className="kb-header-backdrop pointer-events-none overflow-x-clip"
      data-backdrop={backdrop}
      aria-hidden="true"
      data-header-wash="true"
    >
      <div
        className="absolute inset-y-0"
        style={{
          left: "-60px",
          right: "-60px",
          background:
            `radial-gradient(ellipse 60% 70% at 50% 35%, ` +
            `${tagColorAlpha(color, 4.7)} 0%, ` +
            `${tagColorAlpha(color, 2)} 40%, transparent 80%)`,
        }}
      />
      {backdrop === "unicorn" && <UnicornBackdrop />}
    </div>
  );
}
