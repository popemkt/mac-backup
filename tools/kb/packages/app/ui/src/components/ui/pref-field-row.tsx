import type { ComponentProps, ReactNode } from "react";
import { FieldRow } from "@/components/outline/field-row";

/**
 * A settings row: the same `FieldRow` anatomy at depth −1, so a popover field
 * and an outline field agree on label, icon slot and value box while the
 * popover row carries no indent and no border.
 *
 * It sits with the primitives rather than with the outline's fields section
 * because prefs and the view-filter popover render it too, and it composes
 * `FieldRow` — itself a primitive — with no store of its own.
 */
export function PrefFieldRow({
  icon,
  label,
  children,
}: {
  icon: ComponentProps<typeof FieldRow>["icon"];
  label: string;
  children: ReactNode;
}) {
  return (
    <FieldRow depth={-1} icon={icon} label={label}>
      {children}
    </FieldRow>
  );
}
