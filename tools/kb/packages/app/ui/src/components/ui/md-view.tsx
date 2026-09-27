import { createElement, memo, useMemo, type MouseEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { inlineNodes, routeInlineClick, type InlineNode } from "@/lib/md-edit";
import { KB_TEXT_CLASS } from "@/lib/md-inline";

/** DOM attribute names whose React prop is spelled differently. */
const REACT_PROP: Readonly<Record<string, string>> = {
  class: "className",
  contenteditable: "contentEditable",
};

function toReact(node: InlineNode, key: number): ReactNode {
  if (typeof node === "string") return node;
  const props: Record<string, unknown> = { key };
  for (const [name, value] of Object.entries(node.attrs)) {
    props[REACT_PROP[name] ?? name] = name === "controls" ? true : value;
  }
  if ("contenteditable" in node.attrs) props["suppressContentEditableWarning"] = true;
  const children = node.children.map(toReact);
  return createElement(node.tag, props, ...children);
}

/**
 * `text`'s inline markdown as React elements — the element tree
 * `renderInlineMarkdown` builds as DOM (`inlineNodes`), with the markup
 * present and hidden. Clicks are the surface's: see `routeInlineClick`.
 */
export const InlineMarkdown = memo(function InlineMarkdown({ text }: { text: string }) {
  const nodes = useMemo(() => inlineNodes(text), [text]);
  return <>{nodes.map(toReact)}</>;
});

interface MdViewProps {
  text: string;
  className?: string;
  clamp?: boolean;
  /**
   * What clicking an inline `[[id]]` reference does. A primitive does not
   * decide navigation, so the surface passes it — `useRefNavigation` is the
   * one handler every caller uses.
   */
  onRefClick: (e: MouseEvent, id: string) => void;
}

/** Read-only inline markdown: accent refs, tinted code, media. */
export const MdView = memo(function MdView({ text, className, clamp, onRefClick }: MdViewProps) {
  if (!text) {
    return (
      <div
        className={cn(
          KB_TEXT_CLASS,
          clamp === true ? "kb-text-clamp" : "kb-text-row",
          className,
          "text-foreground/25",
        )}
        role="presentation"
      >
        {"​"}
      </div>
    );
  }

  return (
    <div
      className={cn(
        KB_TEXT_CLASS,
        clamp === true ? "kb-text-clamp" : "kb-text-row",
        "kb-md-view flex-1 outline-none",
        className,
      )}
      role="presentation"
      onClick={(e) => {
        routeInlineClick(e, onRefClick);
      }}
    >
      <InlineMarkdown text={text} />
    </div>
  );
});
