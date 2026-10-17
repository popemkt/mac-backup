import { DesignSystemPoint, useContributions } from "@kb/ui-sdk";

/**
 * A design system's swatch: a live sample, not a picture. It carries
 * `data-theme`, so the system's own sheet (the painter adds every
 * contributed one) paints its ground, ink, accent, face, radius and border,
 * in the page's light or dark. Nothing for a system nobody contributes now.
 * It is the design-system field's option preview (DESIGN-UI.md → Option
 * previews), which core's design-system plugin contributes.
 */
export function DesignSystemSwatch({ id }: { readonly id: string }) {
  const systems = useContributions(DesignSystemPoint);
  if (!systems.some(({ value }) => value.key.id === id)) return null;
  return (
    <span
      data-theme={id}
      data-option-preview={id}
      className="flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-1 py-0.5 font-sans text-caption leading-none text-foreground"
    >
      Aa
      <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
    </span>
  );
}
