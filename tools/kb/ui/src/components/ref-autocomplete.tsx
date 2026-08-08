import type { RefCandidate } from "@/lib/refs";
import { cn } from "@/lib/cn";

interface RefAutocompleteProps {
  candidates: RefCandidate[];
  activeIndex: number;
  onSelect: (c: RefCandidate) => void;
}

export function RefAutocomplete({
  candidates,
  activeIndex,
  onSelect,
}: RefAutocompleteProps) {
  return (
    <ul
      className={cn(
        "absolute left-1 top-full z-20 mt-1 max-h-48 w-72 overflow-auto",
        "rounded-md border border-stone-200 bg-[var(--panel)] py-1 shadow-md",
        "text-[12.5px]",
      )}
      role="listbox"
    >
      {candidates.map((c, i) => (
        <li key={c.id}>
          <button
            type="button"
            role="option"
            aria-selected={i === activeIndex}
            className={cn(
              "flex w-full flex-col items-start gap-0.5 px-2.5 py-1.5 text-left",
              i === activeIndex ? "bg-teal-900/10" : "hover:bg-stone-100",
            )}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(c);
            }}
          >
            <span className="truncate text-stone-900">{c.text || c.id}</span>
            <span className="font-mono text-[10px] text-stone-400">{c.id}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
