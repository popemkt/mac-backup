import { tagColorAlpha, type BackdropProps } from "@kb/ui-sdk";

/**
 * The ambient wash: a soft radial tint of the head's colour, weakened
 * through the tag-colour owner so any CSS colour works. A zoomed head paints
 * its tag's colour; home, which has no tag, paints the accent.
 */
export function TintBackdrop({ color, opacity }: { color: string; opacity: number }) {
  return (
    <div
      className="kb-header-tint absolute inset-y-0"
      style={{
        opacity,
        left: 0,
        right: 0,
        background:
          `radial-gradient(ellipse 60% 70% at 50% 35%, ` +
          `${tagColorAlpha(color, 9.4)} 0%, ` +
          `${tagColorAlpha(color, 4)} 40%, transparent 80%)`,
      }}
    />
  );
}

/** The gradient backdrop: the wash alone. */
export function GradientBackdrop({ color, opacity }: BackdropProps) {
  return <TintBackdrop color={color} opacity={opacity} />;
}
