import { createElement, type ReactElement } from "react";
import { TextCard } from "@/components/canvas/canvas-card";
import type { CanvasTextNode } from "@kb/canvas";

const noop = (): void => undefined;
const noopPort = (): void => undefined;

function textCard(
  partial: Partial<CanvasTextNode> & Pick<CanvasTextNode, "id" | "text">,
): CanvasTextNode {
  return {
    type: "text",
    x: 0,
    y: 0,
    width: 200,
    height: 80,
    ...partial,
  };
}

/**
 * Catalog: canvas TextCard (presentational card chrome).
 * KbNodeCard is store-coupled — covered by canvas component tests, not stories.
 */
export const stories = {
  idle: (): ReactElement =>
    createElement(TextCard, {
      card: textCard({ id: "c1", text: "Sticky note" }),
      selected: false,
      onSelect: noop,
      onChange: noop,
      onMoveStart: noop,
      onResizeStart: noop,
      onPortDown: noopPort,
    }),
  selected: (): ReactElement =>
    createElement(TextCard, {
      card: textCard({ id: "c2", text: "Selected card" }),
      selected: true,
      onSelect: noop,
      onChange: noop,
      onMoveStart: noop,
      onResizeStart: noop,
      onPortDown: noopPort,
    }),
  empty: (): ReactElement =>
    createElement(TextCard, {
      card: textCard({ id: "c3", text: "" }),
      selected: false,
      onSelect: noop,
      onChange: noop,
      onMoveStart: noop,
      onResizeStart: noop,
      onPortDown: noopPort,
    }),
} as const;
