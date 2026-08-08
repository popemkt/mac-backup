import { cn } from "@/lib/cn";
import type { OutlineNode } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { FieldsSection } from "./fields-section";
import { TagChipGroup } from "./tag-chip";

/** Zoomed root title + tag wash + fields at depth −1 (DESIGN-RESKIN §1.5). */
export function ZoomedRootHeader({ node }: { node: OutlineNode }) {
  const zoomTo = useOutlineStore((s) => s.zoomTo);
  const gradientColor = node.tags[0]?.color ?? null;

  return (
    <div className="zoomed-root-header px-2 pb-2 pt-1">
      <div className="relative pl-7 pt-1">
        {gradientColor && (
          <div
            className="pointer-events-none absolute"
            style={{
              top: "-40px",
              left: "-60px",
              right: "-60px",
              bottom: "-30px",
              background: `radial-gradient(ellipse 60% 70% at 50% 35%, ${gradientColor}0c 0%, ${gradientColor}05 40%, transparent 80%)`,
            }}
          />
        )}

        <h1
          className={cn(
            "relative flex min-h-9 items-center",
            "text-[20px] font-semibold leading-[1.4] text-foreground/90",
          )}
        >
          {node.text || "Untitled"}
        </h1>

        {node.tags.length > 0 && (
          <div className="relative flex items-center gap-1 pb-2">
            <TagChipGroup
              tags={node.tags}
              onTagClick={(tag, e) => {
                e.stopPropagation();
                zoomTo(tag.id);
              }}
            />
          </div>
        )}
      </div>

      <FieldsSection nodeId={node.id} depth={-1} />
    </div>
  );
}
