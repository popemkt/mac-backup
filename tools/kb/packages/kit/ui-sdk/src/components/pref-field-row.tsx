import type { ComponentProps, ReactNode } from "react";
import { FieldRow } from "./field-row";

/**
 * A settings row: the same `FieldRow` anatomy at depth −1, so a popover field
 * and an outline field agree on label, icon slot and value box while the
 * popover row carries no indent and no border.
 *
 * It is a primitive rather than the outline's because prefs and the
 * view-filter popover both render it, and it composes `FieldRow` with no
 * store of its own.
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
