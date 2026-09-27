import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LockSimpleIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { KB_TEXT_CLASS } from "@/lib/md-inline";
import {
  getCaretSerializedOffset,
  isCanonicalInline,
  renderInlineMarkdown,
  revealMarkupAtSelection,
  routeInlineClick,
  serializeEditable,
  setCaretSerializedOffset,
} from "@/lib/md-edit";
import { fuzzyNodeCandidates, insertRefAtCursor, openRefQuery } from "@/lib/refs";
import { rowTextReadOnlyReason } from "@/lib/contextual-ref";
import type { SchemaIndex } from "@/lib/schema";
import type { NodeMap, TagBadge } from "@/lib/types";
import { InlineMarkdown } from "@/components/ui/md-view";
import { useTextHistory } from "@/components/ui/use-text-history";
import { RefAutocomplete } from "@/components/ref-autocomplete";
import { nearestOffsetForX, offsetFromPoint } from "@/lib/caret";
import { TagChipGroup } from "@/components/outline/tag-chip";

/** Caret command a mounted host consumes — structurally the store's CaretIntent. */
type NodeTextHostCaretAt = number | "end" | { x: number };

interface NodeTextHostPendingCaret {
  instanceKey: string;
  at: NodeTextHostCaretAt;
}

/**
 * Everything the host needs that is not its view props: store reads, store
 * actions, and the two mutation callbacks the surface supplies (stores may
 * not import actions).
 */
export interface NodeTextHostBinding {
  nodes: NodeMap;
  /** What a reference's target resolves against (`rowTextReadOnlyReason`). */
  schema: SchemaIndex;
  zoomTo: (id: string) => void;
  pendingCaret: NodeTextHostPendingCaret | null;
  onRefClick: (e: React.MouseEvent, id: string) => void;
  consumeCaret: (instanceKey: string) => NodeTextHostPendingCaret | null;
  placeCaret: (instanceKey: string, at: NodeTextHostCaretAt) => void;
  selectNode: (id: string | null, instanceKey?: string) => void;
  registerTextHost: (instanceKey: string) => void;
  unregisterTextHost: (instanceKey: string) => void;
  setNodePaletteOpen: (open: boolean) => void;
  onAttachFile: (file: File) => void;
  onRemoveTag: (tagId: string) => void;
}

export interface NodeTextHostProps extends NodeTextHostBinding {
  nodeId: string;
  instanceKey?: string;
  content: string;
  isActive: boolean;
  tags: TagBadge[];
  /** Explicit local placement for non-outline hosts such as a page title. */
  initialCaret?: "end";
  textClassName?: string;
  onBlur?: () => void;
  zoomTitleEditor?: boolean;
  onActivate: (cursorPos?: number) => void;
  onChange: (content: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
}

/**
 * Put the caret where a placement asks, in the serialized text, and show the
 * markup it lands in. Returns the offset it took.
 */
function seatCaret(el: HTMLElement, at: NodeTextHostCaretAt, length: number): number {
  let placed = at === "end" ? length : typeof at === "number" ? at : 0;
  setCaretSerializedOffset(el, placed);
  // Column preservation across vertical navigation (D11): nudge the caret to
  // the character whose visual x best matches the previous row.
  if (typeof at === "object") {
    const adjusted = nearestOffsetForX(el, at.x, "first") ?? nearestOffsetForX(el, at.x, "last");
    if (adjusted !== null) {
      setCaretSerializedOffset(el, adjusted);
      placed = adjusted;
    }
  }
  revealMarkupAtSelection(el);
  return placed;
}

/** The text-history step a chord asks for: ⌘Z undoes, ⇧⌘Z redoes. */
function historyChord(e: React.KeyboardEvent): "undo" | "redo" | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== "z") return null;
  return e.shiftKey ? "redo" : "undo";
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
  nodes,
  schema,
  zoomTo,
  pendingCaret,
  onRefClick,
  consumeCaret,
  placeCaret,
  selectNode,
  registerTextHost,
  unregisterTextHost,
  setNodePaletteOpen,
  onAttachFile,
  onRemoveTag,
}: NodeTextHostProps) {
  /**
   * The row's one text element. It shows the same inline DOM whether the row
   * is being read or edited; editing makes it contentEditable and reveals the
   * markup of the segment under the caret.
   */
  const editorRef = useRef<HTMLDivElement>(null);
  const isComposing = useRef(false);
  const wasActive = useRef(false);
  /**
   * The last text this editor wrote that has not come back as `content` yet.
   * While one is pending, `content` is behind the DOM, not ahead of it.
   */
  const pendingEcho = useRef<string | null>(null);
  /** Query captured at dismissal time; a different query re-opens (D14). */
  const acDismissedQuery = useRef<string | null>(null);
  const [acIndex, setAcIndex] = useState(0);
  /** D14: Escape dismisses the popup without blurring or leaving edit mode. */
  const [acDismissed, setAcDismissed] = useState(false);
  const [cursor, setCursor] = useState(0);
  const readOnlyReason = rowTextReadOnlyReason(nodeId, nodes.get(nodeId), schema);
  const readOnly = readOnlyReason !== null;
  const editing = isActive && !readOnly;
  /** Every write this editor makes goes through here (see `pendingEcho`). */
  const emit = useCallback(
    (text: string) => {
      if (text !== content) pendingEcho.current = text;
      onChange(text);
    },
    [content, onChange],
  );

  const rawRefOpen = useMemo(() => {
    if (!isActive || readOnly) return null;
    return openRefQuery(content, cursor);
  }, [isActive, readOnly, content, cursor]);

  // Dismissal survives until the query itself changes or typing resumes.
  const refOpen = acDismissed && rawRefOpen?.query === acDismissedQuery.current ? null : rawRefOpen;

  const candidates = useMemo(() => {
    if (!refOpen) return [];
    return fuzzyNodeCandidates(nodes, refOpen.query);
  }, [refOpen, nodes]);

  useEffect(() => {
    setAcIndex(0);
  }, [refOpen?.query, refOpen?.start]);

  useLayoutEffect(() => {
    if (!isActive || instanceKey === undefined) return undefined;
    registerTextHost(instanceKey);
    return () => unregisterTextHost(instanceKey);
  }, [isActive, instanceKey, registerTextHost, unregisterTextHost]);

  useLayoutEffect(() => {
    const intent =
      instanceKey !== undefined && pendingCaret?.instanceKey === instanceKey ? pendingCaret : null;
    const localIntent =
      !intent && isActive && !wasActive.current && initialCaret
        ? { instanceKey: instanceKey ?? "local", at: initialCaret }
        : null;
    const placement = intent ?? localIntent;
    if (pendingEcho.current === content) pendingEcho.current = null;
    if (editing && editorRef.current && placement) {
      const el = editorRef.current;

      // While editing, the DOM is the text. It is built from `content` when
      // the editor mounts (empty), and again only when `content` moved on its
      // own — a merge wrote this row — never from a `content` that has not
      // caught up with this editor's own writes yet.
      const movedOnItsOwn = pendingEcho.current === null && serializeEditable(el) !== content;
      if (!wasActive.current || movedOnItsOwn) renderInlineMarkdown(el, content);
      wasActive.current = true;

      el.focus();
      const placedCursor = seatCaret(el, placement.at, content.length);
      setCursor(placedCursor);
      if (intent) consumeCaret(intent.instanceKey);
      setAcDismissed(false);
      acDismissedQuery.current = null;
    } else if (!editing) {
      wasActive.current = false;
      pendingEcho.current = null;
    }
  }, [editing, isActive, content, initialCaret, instanceKey, pendingCaret, consumeCaret]);

  const restoreText = useCallback(
    (state: { text: string; caret: number }) => {
      setCursor(state.caret);
      emit(state.text);
    },
    [emit],
  );
  const stepTextHistory = useTextHistory({
    editorRef,
    editing,
    content,
    onRestore: restoreText,
  });

  // The markup under the caret shows while it is there, wherever the caret
  // moved it from: a click, an arrow, a caret the host placed.
  useEffect(() => {
    const el = editorRef.current;
    if (!editing || !el) return undefined;
    const reveal = () => revealMarkupAtSelection(el);
    document.addEventListener("selectionchange", reveal);
    return () => document.removeEventListener("selectionchange", reveal);
  }, [editing]);

  const applyRef = useCallback(
    (id: string, label: string) => {
      const pos = cursor;
      const inserted = insertRefAtCursor(content, pos, id, label);
      if (!inserted) return;
      emit(inserted.text);
      if (editorRef.current) {
        renderInlineMarkdown(editorRef.current, inserted.text);
        setCaretSerializedOffset(editorRef.current, inserted.cursor);
        revealMarkupAtSelection(editorRef.current);
      }
      setCursor(inserted.cursor);
      if (instanceKey !== undefined) placeCaret(instanceKey, inserted.cursor);
    },
    [content, cursor, instanceKey, emit, placeCaret],
  );

  /**
   * D15: Enter/Tab with an open popup and zero candidates completes the
   * bracket (`]]`) instead of falling through to a destructive split.
   */
  const completeBracket = useCallback(() => {
    if (!editorRef.current) return;
    const next = content.slice(0, cursor) + "]]" + content.slice(cursor);
    emit(next);
    renderInlineMarkdown(editorRef.current, next);
    setCaretSerializedOffset(editorRef.current, cursor + 2);
    revealMarkupAtSelection(editorRef.current);
    setCursor(cursor + 2);
    if (instanceKey !== undefined) placeCaret(instanceKey, cursor + 2);
  }, [content, cursor, instanceKey, emit, placeCaret]);

  const handleInput = useCallback(() => {
    const el = editorRef.current;
    if (el && !isComposing.current) {
      const text = serializeEditable(el);
      const caret = getCaretSerializedOffset(el);
      // Typing that changes what the text means — closing a `**`, breaking a
      // link — rebuilds the tree so the formatting follows; typing that does
      // not leaves the browser's DOM (and its native undo) alone.
      if (!isCanonicalInline(el, text)) {
        renderInlineMarkdown(el, text);
        setCaretSerializedOffset(el, caret);
      }
      revealMarkupAtSelection(el);
      setCursor(caret);
      acDismissedQuery.current = null;
      setAcDismissed(false);
      emit(text);
    }
  }, [emit]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // A reference navigates and a link or player keeps its click, in both
      // states; everything else is a click into the text.
      if (routeInlineClick(e, onRefClick)) return;
      if (!isActive) {
        // F16: caret at click, not at end. The text is already the tree the
        // editor edits, so the point under the click is the offset to edit at.
        let at = content.length;
        const host = editorRef.current;
        if (host) {
          const probed = offsetFromPoint(host, e.clientX, e.clientY);
          if (probed !== null) at = Math.max(0, Math.min(probed, content.length));
        }
        onActivate(at);
      }
      e.stopPropagation();
    },
    [isActive, onActivate, onRefClick, content],
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
      if (files.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      const file = files[0];
      if (file) onAttachFile(file);
    },
    [onAttachFile],
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

      // Text undo is the row's own: native undo cannot follow a rebuilt tree.
      const history = historyChord(e);
      if (history !== null) {
        e.preventDefault();
        stepTextHistory(history);
        return;
      }

      // F15: '/' at offset 0 of an empty node opens the node palette (r1 Mode A MUST, before autocomplete).
      if (
        e.key === "/" &&
        !e.metaKey &&
        !e.ctrlKey &&
        content === "" &&
        getCaretSerializedOffset(editorRef.current) === 0
      ) {
        e.preventDefault();
        // Select this row so palette can anchor, then open it
        selectNode(nodeId, instanceKey);
        // rAF not available in happy-dom — fall back to sync
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(() => setNodePaletteOpen(true));
        } else {
          setNodePaletteOpen(true);
        }
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
          setAcIndex((i) => (i - 1 + candidates.length) % candidates.length);
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
      content,
      nodeId,
      instanceKey,
      selectNode,
      setNodePaletteOpen,
      stepTextHistory,
    ],
  );

  const showPadlock = readOnly && !isActive;
  const textClass = cn(
    KB_TEXT_CLASS,
    "kb-text-row kb-md-view min-h-6 min-w-0 outline-none text-foreground/85",
    textClassName,
  );

  return (
    <>
      <div
        className="relative min-h-6 min-w-0 flex-1"
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/*
          Trailing chrome is a float, and a float can only displace line boxes
          that follow it — so it must come first in source order. This is what
          gives Tana's behaviour: the pill shortens the first line and every
          later line runs full width. As a flex sibling it narrowed all of them.
        */}
        {(showPadlock || tags.length > 0) && (
          <span className="kb-text-trailing flex items-center gap-1.5" data-node-trailing="true">
            {showPadlock && (
              <span
                className="shrink-0 text-foreground/25 opacity-0 transition-opacity duration-150 group-hover/node:opacity-100"
                title={readOnlyReason}
                data-sys-lock="true"
              >
                <LockSimpleIcon size={12} weight="bold" />
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
                onRemoveTag(tag.id);
              }}
            />
          </span>
        )}

        {editing ? (
          <div
            ref={editorRef}
            key="edit"
            className={cn(textClass, "editable caret-foreground/70")}
            contentEditable
            suppressContentEditableWarning
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onKeyUp={() => setCursor(getCaretSerializedOffset(editorRef.current))}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            onBlur={onBlur}
            role="textbox"
            data-zoom-title-editor={zoomTitleEditor === true ? "true" : undefined}
          />
        ) : (
          // The same element and tree, owned by React while nothing edits it.
          <div ref={editorRef} key="view" className={textClass} role="presentation">
            {content ? <InlineMarkdown text={content} /> : "\u200B"}
          </div>
        )}

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
