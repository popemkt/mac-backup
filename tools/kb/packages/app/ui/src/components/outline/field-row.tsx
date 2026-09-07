import { WarningIcon, XIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { FieldType } from "@/lib/field-type";
import { indentStyle } from "@/lib/indent";
import { FieldTypeIcon, type FieldEditor } from "./field-value";

export const FIELD_LABEL_WIDTH = 120;

export interface FieldRowProps {
  depth?: number;
  /** Overrides the type glyph the field's editor declares. */
  icon?: FieldEditor["icon"];
  /** Declared field type (defaults text). Drives the type icon. */
  fieldType?: FieldType;
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

/**
 * The label column: the field's type glyph and its name.
 *
 * A value-only row (a table cell) has no label column at all, so this is one
 * slot the row either fills or does not — not four `!valueOnly &&` guards
 * spread through one component.
 */
function FieldLabel({
  icon,
  fieldType,
  fieldId,
  label,
  labelTitle,
  debug,
  onIconClick,
}: Pick<
  FieldRowProps,
  "icon" | "fieldType" | "fieldId" | "label" | "labelTitle" | "debug" | "onIconClick"
> & { fieldType: FieldType; debug: boolean }) {
  const Glyph = icon;
  return (
    <>
      <span
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center self-start text-foreground/25",
          onIconClick && "cursor-pointer transition-opacity hover:opacity-70",
        )}
        onClick={onIconClick}
      >
        {/* The glyph is the field's editor's glyph: the registry answers "which
            editor" and "which icon" together, so a row cannot show one type's
            glyph over another type's editor. An explicit `icon` overrides it —
            that is what a preferences row passes. */}
        {Glyph ? <Glyph size={13} /> : <FieldTypeIcon fieldType={fieldType} fieldId={fieldId} />}
      </span>

      <span
        className={cn(
          "flex h-6 shrink-0 items-start self-start truncate pl-1 pt-px",
          // Same type scale as node text — only the tint differs (Tana).
          "kb-text",
          debug ? "text-foreground/25" : "text-foreground/35",
        )}
        style={{ width: `${FIELD_LABEL_WIDTH}px` }}
        title={labelTitle ?? (fieldId !== undefined ? `${label} (${fieldId})` : label)}
      >
        <span className="truncate">{label}</span>
        {debug && fieldId !== undefined && (
          <span className="ml-1 truncate font-mono text-[10px] text-foreground/25">{fieldId}</span>
        )}
      </span>
    </>
  );
}

/** The UI-only hint that a value's wire kind is not what the field declares. */
function MismatchWarning() {
  return (
    <span
      className="mr-1 mt-0 flex h-6 w-4 shrink-0 items-center justify-center self-start text-warning"
      title="Value type does not match field type"
      data-mismatch-warning="true"
    >
      <WarningIcon size={11} weight="fill" />
    </span>
  );
}

/** Hover-revealed "drop this field". Width is reserved, so revealing it cannot shift the row. */
function RemoveFieldButton({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      className={cn(
        "ml-1 flex h-6 w-5 shrink-0 items-center justify-center self-start rounded-sm",
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
      <XIcon size={11} weight="bold" />
    </button>
  );
}

/** DESIGN-RESKIN §1.4 — the one field row everywhere (outline, prefs, …).
 * Single source of alignment: label col top-aligned to first value line.
 * Icon + label slots use h-6 baseline; value slot is first-line-flex via items-start.
 */
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
  return (
    <div
      className={cn(
        "field-row group/field flex items-start gap-0 py-1",
        // Tana's field separators appear on hover only. The border is always
        // present and merely transparent, so revealing it cannot shift the row.
        !valueOnly &&
          "border-y border-transparent transition-colors hover:border-foreground/[0.07]",
        debug && "opacity-90",
        valueOnly && "py-0",
        className,
      )}
      style={valueOnly ? undefined : indentStyle(depth + 1)}
      data-field-row="true"
      data-field-value-only={valueOnly ? "true" : undefined}
      data-debug-field={debug ? "true" : undefined}
      data-field-mismatch={mismatch ? "true" : undefined}
    >
      {!valueOnly && (
        <FieldLabel
          icon={icon}
          fieldType={fieldType}
          fieldId={fieldId}
          label={label}
          labelTitle={labelTitle}
          debug={debug}
          onIconClick={onIconClick}
        />
      )}

      {mismatch && <MismatchWarning />}

      <div className={cn("min-w-0 flex-1 self-start", valueOnly ? "px-0" : "px-1")}>{children}</div>

      {!valueOnly && onRemove && <RemoveFieldButton label={label} onRemove={onRemove} />}
    </div>
  );
}
