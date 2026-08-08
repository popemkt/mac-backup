import { memo, useCallback, useMemo, type MouseEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import {
  KB_TEXT_CLASS,
  isSafeHref,
  parseInlineMd,
  type InlineSeg,
} from "@/lib/md-inline";
import { useOutlineStore } from "@/stores/outline.store";

interface MdViewProps {
  text: string;
  className?: string;
}

/** Inactive-row markdown view — memoized parse, accent refs, tinted code. */
export const MdView = memo(function MdView({ text, className }: MdViewProps) {
  const zoomTo = useOutlineStore((s) => s.zoomTo);
  const jumpToNode = useOutlineStore((s) => s.jumpToNode);
  const segs = useMemo(() => parseInlineMd(text), [text]);

  const onRefClick = useCallback(
    (e: MouseEvent, id: string) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.metaKey || e.ctrlKey) jumpToNode(id);
      else zoomTo(id);
    },
    [jumpToNode, zoomTo],
  );

  if (!text) {
    return (
      <div
        className={cn(KB_TEXT_CLASS, className, "text-[var(--kb-muted)]")}
        role="presentation"
      >
        {"\u200B"}
      </div>
    );
  }

  return (
    <div
      className={cn(KB_TEXT_CLASS, "kb-md-view flex-1 outline-none", className)}
      role="presentation"
    >
      {segs.map((seg, i) => renderSeg(seg, i, onRefClick))}
    </div>
  );
});

function renderSeg(
  seg: InlineSeg,
  key: number,
  onRefClick: (e: MouseEvent, id: string) => void,
): ReactNode {
  switch (seg.t) {
    case "text":
      return <span key={key}>{seg.v}</span>;
    case "bold":
      return <strong key={key}>{seg.v}</strong>;
    case "italic":
      return <em key={key}>{seg.v}</em>;
    case "code":
      return (
        <code key={key} className="kb-md-code">
          {seg.v}
        </code>
      );
    case "link":
      // Defense in depth: parser already filters, but never render an
      // unsafe protocol even if a segment arrives from elsewhere.
      if (!isSafeHref(seg.href)) {
        return <span key={key}>{seg.label}</span>;
      }
      return (
        <a
          key={key}
          className="kb-md-link"
          href={seg.href}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          {seg.label}
        </a>
      );
    case "ref":
      return (
        <a
          key={key}
          className="kb-md-ref"
          href={`#${seg.id}`}
          title={seg.id}
          onClick={(e) => onRefClick(e, seg.id)}
        >
          {seg.label}
        </a>
      );
  }
}
