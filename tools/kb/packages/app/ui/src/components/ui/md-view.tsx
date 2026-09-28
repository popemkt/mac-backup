import { createElement, memo, useMemo, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { routePointerClick, type Follow } from "@/lib/follow";
import { inlineNodes, type InlineNode, type RefInk } from "@/lib/md-edit";
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
  // Set through the style object, as the DOM build sets them one by one.
  if (node.vars !== undefined) props["style"] = node.vars;
  if ("contenteditable" in node.attrs) props["suppressContentEditableWarning"] = true;
  const children = node.children.map(toReact);
  return createElement(node.tag, props, ...children);
}

/**
 * `text`'s inline markdown as React elements — the element tree
 * `renderInlineMarkdown` builds as DOM (`inlineNodes`), with the markup
 * present and hidden. Clicks are the surface's: see `routePointerClick`.
 */
export const InlineMarkdown = memo(function InlineMarkdown({
  text,
  ink,
}: {
  text: string;
  /** How a reference is inked (`RefInk`); the surface reads the graph. */
  ink: RefInk;
}) {
  const nodes = useMemo(() => inlineNodes(text, ink), [text, ink]);
  return <>{nodes.map(toReact)}</>;
});

interface MdViewProps {
  text: string;
  className?: string;
  clamp?: boolean;
  /**
   * What following an inline `[[id]]` reference does. A primitive does not
   * decide navigation, so the surface passes it — `useFollow` is the one
   * handler every caller uses.
   */
  onFollow: Follow;
  /** How a reference is inked (`RefInk`), for the same reason. */
  ink: RefInk;
}

/** Read-only inline markdown: inked refs, marked links, tinted code, media. */
export const MdView = memo(function MdView({ text, className, clamp, onFollow, ink }: MdViewProps) {
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
        routePointerClick(e, onFollow);
      }}
    >
      <InlineMarkdown text={text} ink={ink} />
    </div>
  );
});
