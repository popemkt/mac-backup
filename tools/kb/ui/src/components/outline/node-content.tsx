import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LockSimple } from "@phosphor-icons/react";
import { mutations } from "@/actions/mutations";
import { cn } from "@/lib/cn";
import { KB_TEXT_CLASS } from "@/lib/md-inline";
import {
  getCaretSerializedOffset,
  renderEditableContent,
  serializeEditable,
  setCaretSerializedOffset,
} from "@/lib/md-edit";
import {
  fuzzyNodeCandidates,
  insertRefAtCursor,
  openRefQuery,
} from "@/lib/refs";
import { isSysPrefixed } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { MdView } from "@/components/outline/md-view";
import { RefAutocomplete } from "@/components/ref-autocomplete";
import { nearestOffsetForX } from "./caret";
import { TagChipGroup } from "./tag-chip";


interface NodeContentProps {
  nodeId: string;
  instanceKey?: string;
  content: string;
  isActive: boolean;
  tags: Parameters<typeof TagChipGroup>[0]["tags"];
  cursorPosition: number;
  onActivate: (cursorPos?: number) => void;
  onChange: (content: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
}

export function NodeContent({
  nodeId,
  instanceKey,
  content,
  isActive,
  tags,
  cursorPosition,
  onActivate,
  onChange,
  onKeyDown,
}: NodeContentProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const isComposing = useRef(false);
  const wasActive = useRef(false);
  /** Query captured at dismissal time; a different query re-opens (D14). */
  const acDismissedQuery = useRef<string | null>(null);
  const nodes = useOutlineStore((s) => s.nodes);
  const zoomTo = useOutlineStore((s) => s.zoomTo);
  const focusSeq = useOutlineStore((s) => s.focusSeq);
  const [acIndex, setAcIndex] = useState(0);
  /** D14: Escape dismisses the popup without blurring or leaving edit mode. */
  const [acDismissed, setAcDismissed] = useState(false);
  const [cursor, setCursor] = useState(cursorPosition);
  const readOnly = isSysPrefixed(nodeId);


  const rawRefOpen = useMemo(() => {
    if (!isActive || readOnly) return null;
    return openRefQuery(content, cursor);
  }, [isActive, readOnly, content, cursor]);

  // Dismissal survives until the query itself changes or typing resumes.
  const refOpen =
    acDismissed && rawRefOpen?.query === acDismissedQuery.current
      ? null
      : rawRefOpen;

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
        // Rebuild DOM from the authoritative string (atomic pills, D16).
        renderEditableContent(el, content);
      }
      wasActive.current = true;

      el.focus();
      let placedCursor = Math.min(cursorPosition, content.length);
      setCaretSerializedOffset(el, placedCursor);

      // Column preservation across vertical navigation (D11): nudge the
      // caret to the character whose visual x best matches the previous row.
      const focusX = useOutlineStore.getState().focusX;
      if (focusX !== null && focusX !== undefined) {
        const adjusted =
          nearestOffsetForX(el, focusX, "first") ??
          nearestOffsetForX(el, focusX, "last");
        if (adjusted !== null) {
          setCaretSerializedOffset(el, adjusted);
          placedCursor = adjusted;
        }
        useOutlineStore.setState({ focusX: null });
      }

      setCursor(placedCursor);
      setAcDismissed(false);
      acDismissedQuery.current = null;
    } else {
      wasActive.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, cursorPosition, focusSeq]);

  const applyRef = useCallback(
    (id: string, label: string) => {
      const pos = cursor;
      const inserted = insertRefAtCursor(content, pos, id, label);
      if (!inserted) return;
      onChange(inserted.text);
      if (editorRef.current) {
        renderEditableContent(editorRef.current, inserted.text);
        setCaretSerializedOffset(editorRef.current, inserted.cursor);
      }
      setCursor(inserted.cursor);
      useOutlineStore
        .getState()
        .activateNode(nodeId, inserted.cursor, instanceKey);
    },
    [content, cursor, nodeId, instanceKey, onChange],
  );

  /**
   * D15: Enter/Tab with an open popup and zero candidates completes the
   * bracket (`]]`) instead of falling through to a destructive split.
   */
  const completeBracket = useCallback(() => {
    if (!editorRef.current) return;
    const next = content.slice(0, cursor) + "]]" + content.slice(cursor);
    onChange(next);
    renderEditableContent(editorRef.current, next);
    setCaretSerializedOffset(editorRef.current, cursor + 2);
    setCursor(cursor + 2);
    useOutlineStore.getState().activateNode(nodeId, cursor + 2, instanceKey);
  }, [content, cursor, nodeId, instanceKey, onChange]);

  const handleInput = useCallback(() => {
    if (editorRef.current && !isComposing.current) {
      const text = serializeEditable(editorRef.current);
      setCursor(getCaretSerializedOffset(editorRef.current));
      acDismissedQuery.current = null;
      setAcDismissed(false);
      onChange(text);
    }
  }, [onChange]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!isActive) {
        const t = e.target as HTMLElement;
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

      if (refOpen) {
        if (e.key === "ArrowDown" && candidates.length > 0) {
          e.preventDefault();
          setAcIndex((i) => (i + 1) % candidates.length);
          return;
        }
        if (e.key === "ArrowUp" && candidates.length > 0) {
          e.preventDefault();
          setAcIndex(
            (i) => (i - 1 + candidates.length) % candidates.length,
          );
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          if (candidates.length > 0) {
            const pick = candidates[acIndex] ?? candidates[0];
            if (pick) applyRef(pick.id, pick.text);
          } else {
            completeBracket();
          }
          return;
        }
        if (e.key === "Escape") {
          // D14: dismiss the popover only — stay editing, keep caret.
          e.preventDefault();
          e.stopPropagation();
          acDismissedQuery.current = refOpen.query;
          setAcDismissed(true);
          return;
        }
      }

      setCursor(getCaretSerializedOffset(editorRef.current));
      onKeyDown(e);
    },
    [
      refOpen,
      candidates,
      acIndex,
      applyRef,
      completeBracket,
      onKeyDown,
    ],
  );

  const showPadlock = readOnly && !isActive;

  return (
    <>
      <div
        className="relative flex min-h-6 min-w-0 flex-1 items-start gap-1.5"
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {isActive && !readOnly ? (
          <div
            ref={editorRef}
            key="editor"
            className={cn(
              "editable min-h-6 min-w-0 flex-1 self-start",
              KB_TEXT_CLASS,
              "outline-none",
              "text-foreground/85",
              "caret-foreground/70",
            )}
            contentEditable
            suppressContentEditableWarning
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onKeyUp={() =>
              setCursor(
                getCaretSerializedOffset(editorRef.current),
              )
            }
            onClick={(e) => e.stopPropagation()}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            role="textbox"
          />
        ) : (
          <MdView
            text={content}
            className="min-h-6 min-w-0 flex-1 self-start text-foreground/85"
          />
        )}

        {showPadlock && (
          <span
            className="mt-1 shrink-0 text-foreground/25 opacity-0 transition-opacity duration-150 group-hover/node:opacity-100"
            title="System node — read-only"
            data-sys-lock="true"
          >
            <LockSimple size={12} weight="bold" />
          </span>
        )}

        <TagChipGroup
          tags={tags}
          onTagClick={(tag, e) => {
            e.stopPropagation();
            zoomTo(tag.id);
          }}
          onTagRemove={(tag, e) => {
            e.stopPropagation();
            void mutations.removeTag(nodeId, tag.id);
          }}
        />

        {refOpen && candidates.length > 0 && (
          <RefAutocomplete
            candidates={candidates}
            activeIndex={acIndex}
            onSelect={(c) => applyRef(c.id, c.text)}
          />
        )}
      </div>
    </>
  );
}
