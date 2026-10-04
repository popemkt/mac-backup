import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The design system's scale names, as tailwind-merge must know them.
 *
 * tailwind-merge sorts a class into a conflict group by its value's grammar,
 * and it reads a name it does not recognise after `text-` as a colour: left
 * unregistered, `cn("text-label", "text-foreground/50")` would drop the size
 * as a colour conflict. These lists are the names `index.css`'s `@theme
 * inline` block declares, and `lib/tokens.test.ts` fails when the two differ.
 */
export const TYPE_STEPS = [
  "micro",
  "caption",
  "label",
  "tag",
  "meta",
  "ui",
  "note",
  "body",
  "lead",
  "heading",
  "title",
] as const;

/** Elevation levels, lowest first; `shadow-<level>`. Same contract as above. */
export const ELEVATIONS = ["edge", "raised", "lifted", "floating", "overlay", "modal"] as const;

const twMerge = extendTailwindMerge({
  extend: { theme: { text: [...TYPE_STEPS], shadow: [...ELEVATIONS] } },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
