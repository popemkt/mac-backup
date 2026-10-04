import { useMemo } from "react";
import { cn, type ViewProps } from "@kb/ui-sdk";
import { useOutlineStore } from "@/stores/outline.store";
import { snippetRows } from "./snippet-rows";
import type { OutlineSnippetParams } from "@kb/views";

/** A row's indent by its depth below the root (a snippet reaches two levels at most). */
const INDENT: readonly string[] = ["ps-0", "ps-3", "ps-6"];

/** A read-only glimpse of the outline under a node, for a host that shows it in passing. */
export function OutlineSnippet({ params }: ViewProps<OutlineSnippetParams>) {
  const nodes = useOutlineStore((s) => s.nodes);
  const rows = useMemo(() => snippetRows(nodes, params), [nodes, params]);
  if (rows.length === 0)
    return (
      <p className="px-1 py-0.5 text-meta text-foreground/50" data-snippet-missing="true">
        This node is not in the outline.
      </p>
    );
  return (
    <ul className="space-y-0.5 text-ui" data-outline-snippet={params.root}>
      {rows.map((row) => (
        <li
          key={row.id}
          data-snippet-row={row.id}
          className={cn(
            INDENT[row.depth] ?? INDENT[2],
            row.depth === 0 ? "font-medium text-foreground/85" : "text-foreground/65",
          )}
        >
          {row.text}
        </li>
      ))}
    </ul>
  );
}
