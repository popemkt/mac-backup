import type { Icon } from "@phosphor-icons/react";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * How big an icon button is: its box and the glyph inside it, together.
 *
 * `sm` is a row's trailing action (remove, add, pin) and `md` is a slot the
 * size of a text line (a field's type glyph). The glyph size belongs to the
 * box, so two buttons of one size cannot draw two sizes of glyph.
 */
type IconButtonSize = "sm" | "md";

const SIZES: Record<IconButtonSize, { box: string; glyph: number }> = {
  sm: { box: "h-5 w-5", glyph: 11 },
  md: { box: "h-6 w-6", glyph: 13 },
};

interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type" | "children" | "aria-label"
> {
  /** What the button does, for a screen reader; also its tooltip unless `title` says more. */
  label: string;
  icon: Icon;
  size?: IconButtonSize;
  /** Bold for an action glyph (the default); a type glyph reads regular. */
  weight?: "regular" | "bold";
}

/**
 * The one icon-only button: a glyph in a square box, faint at rest, with a
 * tint and stronger ink on hover and a ring on keyboard focus.
 *
 * Every icon-only control draws this box, so a remove "×" and an add "+"
 * side by side are the same size, the same box and the same hover — they
 * used to be two hand-rolled buttons with a box and a glyph each, and sat a
 * pixel apart at two sizes. A caller's `className` places the button (or
 * reveals it on its group's hover); it never restyles the box.
 */
export function IconButton({
  label,
  title,
  icon: Glyph,
  size = "sm",
  weight = "bold",
  className,
  ...rest
}: IconButtonProps) {
  const { box, glyph } = SIZES[size];
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      className={cn(
        "flex shrink-0 cursor-pointer items-center justify-center rounded-sm",
        // `transition` covers opacity too, so a caller that reveals the button
        // on hover fades it in without restating the transition.
        "text-foreground/40 transition duration-100",
        "hover:bg-foreground/[0.06] hover:text-foreground/70",
        "outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
        box,
        className,
      )}
      data-icon-button={size}
      {...rest}
    >
      <Glyph size={glyph} weight={weight} aria-hidden />
    </button>
  );
}
