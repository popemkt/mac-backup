import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Hash } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import {
  fuzzyNodeCandidates,
  insertRefAtCursor,
  openRefQuery,
} from "@/lib/refs";
import type { TagBadge } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { RefAutocomplete } from "@/components/ref-autocomplete";

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
  nodeId,
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
  const nodes = useOutlineStore((s) => s.nodes);
  const [acIndex, setAcIndex] = useState(0);
  const [cursor, setCursor] = useState(cursorPosition);

  const refOpen = useMemo(() => {
    if (!isActive) return null;
    return openRefQuery(content, cursor);
  }, [isActive, content, cursor]);

  const candidates = useMemo(() => {
    if (!refOpen) return [];
    return fuzzyNodeCandidates(nodes, refOpen.query);
  }, [refOpen, nodes]);

  useEffect(() => {
    setAcIndex(0);
  }, [refOpen?.query, refOpen?.start]);

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
        setCursor(pos);
      } else if (!textNode) {
        el.focus();
      }
    } else {
      wasActive.current = false;
    }
    // content intentionally omitted — DOM owns text while active
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, cursorPosition]);

  const readCursor = useCallback(() => {
    const sel = window.getSelection();
    return sel?.focusOffset ?? 0;
  }, []);

  const applyRef = useCallback(
    (id: string, label: string) => {
      const pos = readCursor();
      const inserted = insertRefAtCursor(content, pos, id, label);
      if (!inserted) return;
      onChange(inserted.text);
      if (editorRef.current) {
        editorRef.current.textContent = inserted.text;
        const textNode = editorRef.current.firstChild;
        if (textNode && textNode.nodeType === Node.TEXT_NODE) {
          const sel = window.getSelection();
          const range = document.createRange();
          range.setStart(textNode, inserted.cursor);
          range.collapse(true);
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
      }
      setCursor(inserted.cursor);
      useOutlineStore.getState().activateNode(nodeId, inserted.cursor);
    },
    [content, nodeId, onChange, readCursor],
  );

  const handleInput = useCallback(() => {
    if (editorRef.current && !isComposing.current) {
      const text = editorRef.current.textContent ?? "";
      setCursor(readCursor());
      onChange(text);
    }
  }, [onChange, readCursor]);

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

      if (refOpen && candidates.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setAcIndex((i) => (i + 1) % candidates.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setAcIndex(
            (i) => (i - 1 + candidates.length) % candidates.length,
          );
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          const pick = candidates[acIndex] ?? candidates[0];
          if (pick) applyRef(pick.id, pick.text);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setCursor(readCursor());
          return;
        }
      }

      setCursor(readCursor());
      onKeyDown(e);
    },
    [
      refOpen,
      candidates,
      acIndex,
      applyRef,
      onKeyDown,
      readCursor,
    ],
  );

  return (
    <div
      className={cn(
        "node-content relative flex min-h-6 flex-1 items-start gap-1.5",
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
          onKeyUp={() => setCursor(readCursor())}
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

      {refOpen && candidates.length > 0 && (
        <RefAutocomplete
          candidates={candidates}
          activeIndex={acIndex}
          onSelect={(c) => applyRef(c.id, c.text)}
        />
      )}
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
