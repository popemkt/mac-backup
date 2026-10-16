/**
 * The page's field editor: one field of one node, drawn and edited as its
 * type and the write rule allow (DESIGN-UI.md → Field values). Every surface
 * that shows a node's field draws it with this one editor, so a field reads
 * and edits the same wherever it appears: a frame view lays out fields its
 * host edits, and the agent's dock edits the agent's settings, which are
 * fields on its node. Core names no editor; the outline provides its own
 * while it is loaded, and with none provided a field draws nothing.
 */
import type { ComponentType } from "react";
import { Service } from "@kb/plugin";
import { useService } from "./plugins";
import type { FieldContext } from "./schema";
import type { PropValue } from "./types";

/** One field of one node, as the page edits it. */
export interface FieldEditorProps {
  readonly nodeId: string;
  readonly fieldId: string;
  /** The field's name, as the surface resolved it. */
  readonly label: string;
  readonly values: PropValue[];
  /** What the values resolve against (the surface's `GraphRead`). */
  readonly context: FieldContext;
  /** The row instance the field is drawn under, inside a frame (the keyboard's way back). */
  readonly instanceKey?: string;
  /** Only the value, without the field's label (a table cell). */
  readonly valueOnly?: boolean;
  /** Indent of the label column; a card or a settings row passes -1. */
  readonly depth?: number;
}

/** Where a plugin provides the page's field editor while it is loaded. */
export const FieldEditorService = Service<ComponentType<FieldEditorProps>>()("ui.field-editor");

/** What a field is drawn with while no editor is provided: nothing. */
const NO_FIELD_EDITOR: ComponentType<FieldEditorProps> = () => null;

/** The page's field editor now, re-read when the plugins change. */
export function useFieldEditor(): ComponentType<FieldEditorProps> {
  return useService(FieldEditorService) ?? NO_FIELD_EDITOR;
}
