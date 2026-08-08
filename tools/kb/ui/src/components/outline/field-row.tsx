import {
  CalendarBlank,
  Hash,
  LinkSimple,
  TextT,
  ToggleRight,
  X,
  type Icon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { PropValue } from "@/lib/types";

export const FIELD_LABEL_WIDTH = 120;

const FIELD_ICON: Record<
  PropValue["t"],
  Icon
> = {
  str: TextT,
  num: Hash,
  bool: ToggleRight,
  date: CalendarBlank,
  ref: LinkSimple,
};

export interface FieldRowProps {
  depth?: number;
  icon?: Icon;
  fieldType?: PropValue["t"];
  fieldId?: string;
  label: string;
  labelTitle?: string;
  debug?: boolean;
  onIconClick?: (e: React.MouseEvent) => void;
  onRemove?: () => void;
  children: React.ReactNode;
  className?: string;
}

/** DESIGN-RESKIN §1.4 — the one field row everywhere (outline, prefs, …). */
export function FieldRow({
  depth = 0,
  icon,
  fieldType = "str",
  fieldId,
  label,
  labelTitle,
  debug = false,
  onIconClick,
  onRemove,
  children,
  className,
}: FieldRowProps) {
  const IconCmp = icon ?? FIELD_ICON[fieldType] ?? TextT;

  return (
    <div
      className={cn(
        "field-row group/field flex items-start py-1",
        debug && "opacity-90",
        className,
      )}
      style={{ paddingLeft: `${(depth + 1) * 24}px` }}
      data-field-row="true"
      data-debug-field={debug ? "true" : undefined}
    >
      <span
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center text-foreground/25",
          onIconClick && "cursor-pointer transition-opacity hover:opacity-70",
        )}
        onClick={onIconClick}
      >
        <IconCmp size={13} />
      </span>

      <span
        className={cn(
          "flex h-6 shrink-0 items-center truncate pl-1",
          "text-[14.5px] font-medium leading-[1.6]",
          debug ? "text-foreground/35" : "text-foreground/35",
        )}
        style={{ width: `${FIELD_LABEL_WIDTH}px` }}
        title={labelTitle ?? (fieldId ? `${label} (${fieldId})` : label)}
      >
        {label}
        {debug && fieldId && (
          <span className="ml-1 truncate font-mono text-[10px] text-foreground/35">
            {fieldId}
          </span>
        )}
      </span>

      {onRemove && (
        <button
          type="button"
          className={cn(
            "mr-1 mt-px flex h-6 w-5 shrink-0 items-center justify-center rounded-sm",
            "text-foreground/20 opacity-0 transition-opacity",
            "group-hover/field:opacity-100 hover:bg-foreground/8 hover:text-foreground/50",
            "focus:opacity-100",
          )}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title={`Remove ${label}`}
          aria-label={`Remove ${label}`}
        >
          <X size={11} weight="bold" />
        </button>
      )}

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
