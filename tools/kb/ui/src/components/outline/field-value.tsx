import type { PropValue } from "@/lib/types";

interface PropValueEditorProps {
  value: PropValue;
  display: string;
  onCommit: (next: PropValue) => void;
  compact?: boolean;
}

/** Typed prop value editor — shared by side panel and inline FieldsSection. */
export function PropValueEditor({
  value,
  display,
  onCommit,
  compact = false,
}: PropValueEditorProps) {
  const inputClass = compact
    ? "min-w-0 flex-1 rounded border border-[var(--kb-line)] bg-transparent px-1.5 py-0.5 text-[12px]"
    : "min-w-0 flex-1 rounded border border-stone-200 px-1.5 py-0.5 text-[12px]";

  if (value.t === "bool") {
    return (
      <label className="flex flex-1 items-center gap-2 text-[12px]">
        <input
          type="checkbox"
          checked={value.v}
          onChange={(e) => onCommit({ t: "bool", v: e.target.checked })}
        />
        {value.v ? "true" : "false"}
      </label>
    );
  }

  if (value.t === "num") {
    return (
      <input
        type="number"
        className={inputClass}
        defaultValue={value.v}
        onBlur={(e) => {
          const n = Number(e.target.value);
          if (!Number.isNaN(n) && n !== value.v) onCommit({ t: "num", v: n });
        }}
      />
    );
  }

  if (value.t === "date") {
    return (
      <input
        type="date"
        className={inputClass}
        defaultValue={value.v.slice(0, 10)}
        onBlur={(e) => {
          if (e.target.value && e.target.value !== value.v.slice(0, 10)) {
            onCommit({ t: "date", v: e.target.value });
          }
        }}
      />
    );
  }

  if (value.t === "ref") {
    return (
      <input
        className={`${inputClass} font-mono text-[11px]`}
        defaultValue={value.v}
        title={display}
        onBlur={(e) => {
          const next = e.target.value.trim();
          if (next && next !== value.v) onCommit({ t: "ref", v: next });
        }}
      />
    );
  }

  return (
    <input
      className={inputClass}
      defaultValue={value.v}
      onBlur={(e) => {
        if (e.target.value !== value.v) {
          onCommit({ t: "str", v: e.target.value });
        }
      }}
    />
  );
}
