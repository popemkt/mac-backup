import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Hash } from "@phosphor-icons/react";
import { mutations } from "@/actions/mutations";
import { cn } from "@/lib/cn";
import { KB_TEXT_CLASS } from "@/lib/md-inline";
import {
  fuzzyNodeCandidates,
  insertRefAtCursor,
  openRefQuery,
} from "@/lib/refs";
import type { TagBadge } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { MdView } from "@/components/outline/md-view";
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
        const t = e.target as HTMLElement;
        // Ref / md links / media own the click; don't enter edit.
        if (
          t.closest(
            "a.kb-md-ref, a.kb-md-link, .kb-md-media, img.kb-md-media, video.kb-md-media, audio.kb-md-media",
          )
        ) {
          e.stopPropagation();
          return;
        }
        onActivate(content.length);
      }
      e.stopPropagation();
    },
    [isActive, onActivate, content.length],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (![...e.dataTransfer.types].includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      const files = e.dataTransfer.files;
      if (!files || files.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      const file = files[0];
      if (file) void mutations.attachFileToNode(nodeId, file);
    },
    [nodeId],
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
        "node-content relative flex flex-1 items-start gap-1.5",
        "rounded-sm px-1",
        isSelected && !isActive && "bg-[var(--kb-select)]",
      )}
      style={{ minHeight: "var(--kb-row-h)" }}
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isActive ? (
        <div
          ref={editorRef}
          key="editor"
          className={cn(
            "editable",
            KB_TEXT_CLASS,
            "flex-1 outline-none",
            "text-[var(--kb-fg)]",
            "caret-[var(--kb-accent)]",
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
        <MdView text={content} className="text-[var(--kb-fg)]" />
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
    <div
      className="flex items-center gap-0.5"
      style={{ height: "var(--kb-row-h)" }}
    >
      {tags.map((tag) => (
        <span
          key={tag.id}
          className={cn(
            "kb-chip inline-flex items-center gap-0.5 rounded-sm px-1.5 py-px",
            "font-medium select-none whitespace-nowrap",
            "cursor-pointer transition-opacity hover:opacity-70",
            "bg-[var(--kb-accent-soft)] text-[var(--kb-accent)]",
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
