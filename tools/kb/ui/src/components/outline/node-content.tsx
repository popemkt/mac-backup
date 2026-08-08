import { useCallback, useEffect, useRef } from "react";
import { Hash } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { TagBadge } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";

interface NodeContentProps {
  nodeId: string;
  content: string;
  isActive: boolean;
  isSelected: boolean;
  tags: TagBadge[];
  cursorPosition: number;
  onActivate: (cursorPos?: number) => void;
  onChange: (content: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
}

export function NodeContent({
  content,
  isActive,
  isSelected,
  tags,
  cursorPosition,
  onActivate,
  onChange,
  onKeyDown,
}: NodeContentProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const isComposing = useRef(false);
  const wasActive = useRef(false);

  // When becoming active: set DOM content and focus with cursor position.
  // NEVER set DOM content during active editing — the DOM is the source of truth.
  useEffect(() => {
    if (isActive && editorRef.current) {
      const el = editorRef.current;

      if (!wasActive.current) {
        el.textContent = content;
      }
      wasActive.current = true;

      el.focus();
      const textNode = el.firstChild;
      if (textNode && textNode.nodeType === Node.TEXT_NODE) {
        const sel = window.getSelection();
        const range = document.createRange();
        const pos = Math.min(
          cursorPosition,
          textNode.textContent?.length ?? 0,
        );
        range.setStart(textNode, pos);
        range.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(range);
      } else if (!textNode) {
        el.focus();
      }
    } else {
      wasActive.current = false;
    }
    // content intentionally omitted — DOM owns text while active
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, cursorPosition]);

  const handleInput = useCallback(() => {
    if (editorRef.current && !isComposing.current) {
      onChange(editorRef.current.textContent ?? "");
    }
  }, [onChange]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!isActive) {
        requestAnimationFrame(() => {
          const sel = window.getSelection();
          if (
            sel &&
            sel.rangeCount > 0 &&
            editorRef.current?.contains(sel.anchorNode)
          ) {
            onActivate(sel.focusOffset);
          } else {
            onActivate(content.length);
          }
        });
      }
      e.stopPropagation();
    },
    [isActive, onActivate, content.length],
  );

  const handleCompositionStart = useCallback(() => {
    isComposing.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    isComposing.current = false;
    handleInput();
  }, [handleInput]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (isComposing.current) return;
      onKeyDown(e);
    },
    [onKeyDown],
  );

  return (
    <div
      className={cn(
        "node-content flex min-h-6 flex-1 items-start gap-1.5",
        "rounded-sm px-1",
        isSelected && !isActive && "bg-teal-900/8",
      )}
      onClick={handleClick}
    >
      {isActive ? (
        <div
          ref={editorRef}
          key="editor"
          className={cn(
            "editable flex-1 outline-none",
            "text-[14.5px] leading-[1.6]",
            "text-stone-800",
            "caret-teal-800",
          )}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          role="textbox"
        />
      ) : (
        <div
          ref={editorRef}
          className={cn(
            "editable flex-1 outline-none",
            "text-[14.5px] leading-[1.6]",
            "text-stone-800",
            !content && "text-stone-400",
          )}
          role="presentation"
        >
          {content || "\u200B"}
        </div>
      )}

      {tags.length > 0 && <TagBadges tags={tags} />}
    </div>
  );
}

function TagBadges({ tags }: { tags: TagBadge[] }) {
  const zoomTo = useOutlineStore((s) => s.zoomTo);

  return (
    <div className="flex h-6 items-center gap-0.5">
      {tags.map((tag) => (
        <span
          key={tag.id}
          className={cn(
            "inline-flex items-center gap-0.5 rounded-sm px-1.5 py-px",
            "text-[11px] font-medium leading-[1.8]",
            "select-none whitespace-nowrap",
            "cursor-pointer transition-opacity hover:opacity-70",
            "bg-teal-900/8 text-teal-900/60",
          )}
          onClick={(e) => {
            e.stopPropagation();
            zoomTo(tag.id);
          }}
          title={`Go to: ${tag.name}`}
        >
          <Hash size={10} weight="bold" className="shrink-0 opacity-60" />
          {tag.name}
        </span>
      ))}
    </div>
  );
}
