/**
 * The one info card every study shows (Lab principles P4): the technique,
 * what it teaches, the principles it applies (by id; their text lives once,
 * in DESIGN-UI.md → Lab principles), and its live parameters.
 */
import { useId, useState } from "react";
import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react";
import { EnumSelect } from "@/components/ui/enum-select";
import type {
  LabControl,
  LabControlValue,
  LabControlValues,
  LabStudy,
} from "@/components/lab/kit/contract";

function Control({
  control,
  value,
  onChange,
}: {
  control: LabControl;
  value: LabControlValue | undefined;
  onChange: (value: LabControlValue) => void;
}) {
  const id = useId();
  const label = (
    <label htmlFor={id} className="min-w-0 flex-1 truncate text-foreground/55">
      {control.label}
    </label>
  );
  switch (control.kind) {
    case "range": {
      const current = typeof value === "number" ? value : control.value;
      return (
        <div className="flex items-center gap-2">
          {label}
          <input
            id={id}
            type="range"
            className="w-28 accent-primary"
            min={control.min}
            max={control.max}
            step={control.step}
            value={current}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          <span className="w-12 text-right tabular-nums text-foreground/45">
            {current}
            {control.unit ?? ""}
          </span>
        </div>
      );
    }
    case "toggle":
      return (
        <div className="flex items-center gap-2">
          {label}
          <input
            id={id}
            type="checkbox"
            className="accent-primary"
            checked={typeof value === "boolean" ? value : control.value}
            onChange={(e) => onChange(e.target.checked)}
          />
        </div>
      );
    case "choice":
      return (
        <div className="flex items-center gap-2">
          {label}
          <EnumSelect
            className="rounded-sm bg-transparent text-foreground/70 outline-none"
            value={typeof value === "string" ? value : control.value}
            options={control.options}
            onChange={onChange}
            testId={id}
          />
        </div>
      );
    default:
      return null;
  }
}

export function InfoCard({
  study,
  values,
  onChange,
}: {
  study: LabStudy;
  values: LabControlValues;
  onChange: (id: string, value: LabControlValue) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section
      aria-label={`${study.label}: how it works`}
      className="pointer-events-auto w-80 rounded-lg border border-foreground/10 bg-popover/85 text-meta shadow-floating backdrop-blur-md"
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="min-w-0 flex-1 truncate font-medium text-foreground/80">
          {study.technique}
        </span>
        {open ? <CaretDownIcon size={12} /> : <CaretUpIcon size={12} />}
      </button>
      {open ? (
        <div className="flex flex-col gap-2.5 px-3 pb-3">
          <p className="leading-relaxed text-foreground/60">{study.teaches}</p>
          <ul className="flex flex-col gap-1">
            {study.rules.map((rule) => (
              <li key={rule.id} className="flex gap-2 leading-snug text-foreground/55">
                <span className="w-6 shrink-0 font-mono text-label text-primary">{rule.id}</span>
                <span>{rule.how}</span>
              </li>
            ))}
          </ul>
          {study.controls.length > 0 ? (
            <div className="flex flex-col gap-1.5 border-t border-foreground/[0.06] pt-2.5">
              {study.controls.map((control) => (
                <Control
                  key={control.id}
                  control={control}
                  value={values[control.id]}
                  onChange={(value) => onChange(control.id, value)}
                />
              ))}
            </div>
          ) : null}
          <p className="text-label text-foreground/35">Principles: DESIGN-UI.md → Lab principles</p>
        </div>
      ) : null}
    </section>
  );
}
