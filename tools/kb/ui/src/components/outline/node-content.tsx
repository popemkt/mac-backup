import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { useUiStore } from "@/stores/ui.store";
import { MdView } from "@/components/outline/md-view";
import { RefAutocomplete } from "@/components/ref-autocomplete";
import { nearestOffsetForX, offsetFromPoint } from "./caret";
import { TagChipGroup } from "./tag-chip";


export interface NodeTextHostProps {
  nodeId: string;
  instanceKey?: string;
  content: string;
  isActive: boolean;
  tags: Parameters<typeof TagChipGroup>[0]["tags"];
  /** @deprecated compatibility for the canvas editor; outline uses CaretIntent. */
  cursorPosition?: number;
  /** Explicit local placement for non-outline hosts such as a page title. */
  initialCaret?: "end";
  textClassName?: string;
  onBlur?: () => void;
  zoomTitleEditor?: boolean;
  onActivate: (cursorPos?: number) => void;
  onChange: (content: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
}

export function NodeTextHost({
  nodeId,
  instanceKey,
  content,
  isActive,
  tags,
  initialCaret,
  textClassName,
  onBlur,
  zoomTitleEditor,
  onActivate,
  onChange,
  onKeyDown,
}: NodeTextHostProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const mdViewRef = useRef<HTMLDivElement>(null);
  const isComposing = useRef(false);
  const wasActive = useRef(false);
  /** Query captured at dismissal time; a different query re-opens (D14). */
  const acDismissedQuery = useRef<string | null>(null);
  const nodes = useOutlineStore((s) => s.nodes);
  const zoomTo = useOutlineStore((s) => s.zoomTo);
  const pendingCaret = useOutlineStore((s) => s.pendingCaret);
  const [acIndex, setAcIndex] = useState(0);
  /** D14: Escape dismisses the popup without blurring or leaving edit mode. */
  const [acDismissed, setAcDismissed] = useState(false);
  const [cursor, setCursor] = useState(0);
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

  useLayoutEffect(() => {
    if (!isActive || !instanceKey) return;
    const registry = useOutlineStore.getState();
    registry.registerTextHost(instanceKey);
    return () => registry.unregisterTextHost(instanceKey);
  }, [isActive, instanceKey]);

  useLayoutEffect(() => {
    const intent =
      instanceKey && pendingCaret?.instanceKey === instanceKey ? pendingCaret : null;
    const localIntent =
      !intent && isActive && !wasActive.current && initialCaret
        ? { instanceKey: instanceKey ?? "local", at: initialCaret }
        : null;
    const placement = intent ?? localIntent;
    if (isActive && editorRef.current && placement) {
      const el = editorRef.current;

      if (!wasActive.current) {
        // Rebuild DOM from the authoritative string (atomic pills, D16).
        renderEditableContent(el, content);
      }
      wasActive.current = true;

      el.focus();
      let placedCursor =
        placement.at === "end"
          ? content.length
          : typeof placement.at === "number"
            ? placement.at
            : 0;
      setCaretSerializedOffset(el, placedCursor);

      // Column preservation across vertical navigation (D11): nudge the
      // caret to the character whose visual x best matches the previous row.
      if (typeof placement.at === "object") {
        const adjusted =
          nearestOffsetForX(el, placement.at.x, "first") ??
          nearestOffsetForX(el, placement.at.x, "last");
        if (adjusted !== null) {
          setCaretSerializedOffset(el, adjusted);
          placedCursor = adjusted;
        }
      }

      setCursor(placedCursor);
      if (intent) useOutlineStore.getState().consumeCaret(intent.instanceKey);
      setAcDismissed(false);
      acDismissedQuery.current = null;
    } else {
      wasActive.current = false;
    }
  }, [isActive, content, initialCaret, instanceKey, pendingCaret]);

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
      if (instanceKey) useOutlineStore.getState().placeCaret(instanceKey, inserted.cursor);
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
    if (instanceKey) useOutlineStore.getState().placeCaret(instanceKey, cursor + 2);
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
        // F16: caret at click, not at end. Probe the rendered text; fallback to end.
        let at = content.length;
        const host = mdViewRef.current;
        if (host) {
          const probed = offsetFromPoint(host, e.clientX, e.clientY);
          if (probed !== null) at = Math.max(0, Math.min(probed, content.length));
        }
        onActivate(at);
      }
      e.stopPropagation();
    },
    [isActive, onActivate, content],
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

      // F15: '/' at offset 0 of an empty node opens the node palette (r1 Mode A MUST, before autocomplete).
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && content === "" && getCaretSerializedOffset(editorRef.current) === 0) {
        e.preventDefault();
        // Select this row so palette can anchor, then open it
        useOutlineStore.getState().selectNode(nodeId, instanceKey);
        // rAF not available in happy-dom — fall back to sync
        const raf = (globalThis as unknown as { requestAnimationFrame?: (cb: () => void) => number }).requestAnimationFrame;
        if (raf) raf(() => useUiStore.getState().setNodePaletteOpen(true));
        else useUiStore.getState().setNodePaletteOpen(true);
        return;
      }

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
              "editable kb-text-row min-h-6 min-w-0 flex-1 self-start",
              KB_TEXT_CLASS,
              "outline-none",
              "text-foreground/85",
              "caret-foreground/70",
              textClassName,
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
            onBlur={onBlur}
            role="textbox"
            data-zoom-title-editor={zoomTitleEditor ? "true" : undefined}
          />
        ) : (
          <div ref={mdViewRef} className="min-h-6 min-w-0 flex-1 self-start">
            <MdView
              text={content}
              className={cn("min-h-6 min-w-0 flex-1 self-start text-foreground/85", textClassName)}
              clamp={false}
            />
          </div>
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

/** Compatibility name while callers migrate to the common text host. */
export const NodeContent = NodeTextHost;
