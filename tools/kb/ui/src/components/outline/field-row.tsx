import {
  CalendarBlank,
  Hash,
  LinkSimple,
  TextT,
  ToggleRight,
  Warning,
  X,
  type Icon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import {
  fieldTypeIconKind,
  type FieldType,
} from "@/lib/field-type";
import type { PropValue } from "@/lib/types";

export const FIELD_LABEL_WIDTH = 120;

const FIELD_ICON: Record<PropValue["t"], Icon> = {
  str: TextT,
  num: Hash,
  bool: ToggleRight,
  date: CalendarBlank,
  ref: LinkSimple,
};

export interface FieldRowProps {
  depth?: number;
  icon?: Icon;
  /** Declared field type (defaults text). Drives the type icon. */
  fieldType?: FieldType | PropValue["t"];
  fieldId?: string;
  label: string;
  labelTitle?: string;
  debug?: boolean;
  /** Subtle type-mismatch affordance (UI-only; writes stay permissive). */
  mismatch?: boolean;
  /** Table cells: keep FieldRow shell, hide icon/label chrome (value slot only). */
  valueOnly?: boolean;
  onIconClick?: (e: React.MouseEvent) => void;
  onRemove?: () => void;
  children: React.ReactNode;
  className?: string;
}

function resolveIconKind(
  fieldType: FieldType | PropValue["t"],
): PropValue["t"] {
  switch (fieldType) {
    case "text":
    case "number":
    case "url":
    case "checkbox":
    case "ref":
      return fieldTypeIconKind(fieldType);
    case "date":
      return "date";
    case "str":
    case "num":
    case "bool":
      return fieldType;
    default:
      return "str";
  }
}

/** DESIGN-RESKIN §1.4 — the one field row everywhere (outline, prefs, …). */
export function FieldRow({
  depth = 0,
  icon,
  fieldType = "text",
  fieldId,
  label,
  labelTitle,
  debug = false,
  mismatch = false,
  valueOnly = false,
  onIconClick,
  onRemove,
  children,
  className,
}: FieldRowProps) {
  const IconCmp = icon ?? FIELD_ICON[resolveIconKind(fieldType)] ?? TextT;

  return (
    <div
      className={cn(
        "field-row group/field flex items-start py-1",
        debug && "opacity-90",
        valueOnly && "py-0",
        className,
      )}
      style={valueOnly ? undefined : { paddingLeft: `${(depth + 1) * 24}px` }}
      data-field-row="true"
      data-field-value-only={valueOnly ? "true" : undefined}
      data-debug-field={debug ? "true" : undefined}
      data-field-mismatch={mismatch ? "true" : undefined}
    >
      {!valueOnly && (
        <>
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
              debug ? "text-foreground/25" : "text-foreground/35",
            )}
            style={{ width: `${FIELD_LABEL_WIDTH}px` }}
            title={labelTitle ?? (fieldId ? `${label} (${fieldId})` : label)}
          >
            {label}
            {debug && fieldId && (
              <span className="ml-1 truncate font-mono text-[10px] text-foreground/25">
                {fieldId}
              </span>
            )}
          </span>
        </>
      )}

      {mismatch && (
        <span
          className="mr-1 mt-px flex h-6 w-4 shrink-0 items-center justify-center text-warning"
          title="Value type does not match field type"
          data-mismatch-warning="true"
        >
          <Warning size={11} weight="fill" />
        </span>
      )}

      {!valueOnly && onRemove && (
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

      <div className={cn("min-w-0 flex-1", valueOnly ? "px-0" : "px-1")}>
        {children}
      </div>
    </div>
  );
}
