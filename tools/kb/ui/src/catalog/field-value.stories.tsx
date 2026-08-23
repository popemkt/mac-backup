import { createElement, type ReactElement } from "react";
import { PropValueEditor } from "@/components/outline/field-value";

const nodes = new Map();
const noop = (): void => undefined;

/** Catalog: PropValueEditor (FieldValue) — checkbox / text / empty url. */
export const stories = {
  checkboxChecked: (): ReactElement =>
    createElement(PropValueEditor, {
      value: { t: "bool", v: true },
      display: "yes",
      fieldType: "checkbox",
      onCommit: noop,
      nodes,
    }),
  textFilled: (): ReactElement =>
    createElement(PropValueEditor, {
      value: { t: "str", v: "hello" },
      display: "hello",
      fieldType: "text",
      onCommit: noop,
      nodes,
    }),
  urlEmpty: (): ReactElement =>
    createElement(PropValueEditor, {
      value: { t: "str", v: "" },
      display: "",
      fieldType: "url",
      onCommit: noop,
      nodes,
    }),
} as const;
