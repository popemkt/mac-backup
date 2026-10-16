import { mentionSpans } from "./mention.ts";

/**
 * Outline paste: the text form of a whole outline, modelled on Tana Paste.
 * This module is its syntax and nothing else — it reads lines into a tree and
 * resolves nothing against a graph. What each part of the tree means (a tag
 * by name, a field's declared type, a `[[ref]]`'s target) is `node.addTree`'s
 * to decide, through the same resolvers `node.add` uses. The format is stated
 * once, in DESIGN.md → Outline paste.
 */

/** The optional first line that marks Tana Paste. */
export const OUTLINE_HEADER = "%%tana%%";

/** One value of a field line: inline after `::`, or one nested `- ` item. */
export interface OutlineValue {
  /** 1-based line in the source. */
  line: number;
  /** The value as written, trimmed; read as the field's type later. */
  raw: string;
}

/** A `name:: value` line, with its nested values. */
export interface OutlineField {
  line: number;
  name: string;
  values: OutlineValue[];
}

/** A `- ` item that becomes a node. */
export interface OutlineItem {
  line: number;
  /** The item's text with its `#tag`s taken out, trimmed. */
  text: string;
  /** Tag names, in order: `#name` and `#[[multi word name]]`. */
  tags: string[];
  fields: OutlineField[];
  children: OutlineItem[];
}

export type OutlineParse =
  | { ok: true; items: OutlineItem[] }
  | { ok: false; line: number; reason: string };

/** A line of the outline, placed in the tree being built. */
type Open =
  | { kind: "item"; indent: string; childIndent?: string; item: OutlineItem }
  | { kind: "field"; indent: string; childIndent?: string; field: OutlineField }
  | { kind: "value"; indent: string; childIndent?: string };

class OutlineSyntaxError extends Error {
  readonly line: number;
  constructor(line: number, reason: string) {
    super(reason);
    this.line = line;
  }
}

const INDENT_RE = /^[ \t]*/;
/** `name::` then whitespace or the end of the line; the name may not hold `::`. */
const FIELD_RE = /^(.+?)::(?:[ \t]+(.*))?$/;
/** Letters, digits, `_` and `-`, with `.` inside a name (`#v1.2`) but never ending it (`#todo.`). */
const TAG_NAME_RE = /^[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*/u;
const WHITESPACE_RE = /\s/;

function isBlank(ch: string | undefined): boolean {
  return ch !== undefined && WHITESPACE_RE.test(ch);
}

/**
 * Take the `#tag`s out of an item's text. A tag starts at the beginning of the
 * text or after whitespace, so `C#`, `a#b` and a URL's `/#fragment` stay text,
 * and a `#` followed by a space (a markdown heading) is not a tag. A `#`
 * inside a `[[ref]]` is part of that ref. `#[[name]]` names a tag whose name
 * has spaces in it.
 */
function splitTags(content: string): { text: string; tags: string[] } {
  const spans = mentionSpans(content);
  const tags: string[] = [];
  let out = "";
  let at = 0;
  for (let i = 0; i < content.length; i++) {
    if (content[i] !== "#") continue;
    if (i > 0 && !isBlank(content[i - 1])) continue;
    if (spans.some((span) => span.start <= i && i < span.end)) continue;
    const bracketed = spans.find((span) => span.start === i + 1);
    const bare = TAG_NAME_RE.exec(content.slice(i + 1))?.[0];
    const end = bracketed?.end ?? (bare === undefined ? undefined : i + 1 + bare.length);
    const name = bracketed?.id ?? bare;
    if (end === undefined || name === undefined) continue;
    tags.push(name);
    out += content.slice(at, i > 0 ? i - 1 : i);
    at = end;
    i = end - 1;
  }
  out += content.slice(at);
  return { text: out.trim(), tags };
}

/** Tana's `[[date:…]]` is a date node, which kb does not have; say so by line. */
function rejectDates(text: string, line: number): void {
  for (const span of mentionSpans(text)) {
    if (span.id.startsWith("date:")) {
      throw new OutlineSyntaxError(
        line,
        `date references are not supported ([[${span.id}]]): write the date as a date field's value`,
      );
    }
  }
}

/** Where a line of `indent` sits: the open line it nests under, or null for a top-level item. */
function placeLine(stack: Open[], indent: string, rootIndent: string, line: number): Open | null {
  while (stack.length > 0) {
    const top = stack.at(-1);
    if (top !== undefined && indent.length > top.indent.length && indent.startsWith(top.indent)) {
      break;
    }
    stack.pop();
  }
  const parent = stack.at(-1) ?? null;
  const expected = parent === null ? rootIndent : parent.childIndent;
  if (expected === undefined && parent !== null) {
    parent.childIndent = indent;
    return parent;
  }
  if (indent !== expected) {
    const reason =
      parent === null && indent.length < rootIndent.length
        ? "indented less than the first item"
        : "indentation matches no line above it (mixed tabs and spaces, or an indent between two levels)";
    throw new OutlineSyntaxError(line, reason);
  }
  return parent;
}

function openItem(content: string, indent: string, line: number): Open & { kind: "item" } {
  if (content.startsWith("%%")) {
    throw new OutlineSyntaxError(
      line,
      `Tana directives are not supported (only a first-line ${OUTLINE_HEADER} header is)`,
    );
  }
  rejectDates(content, line);
  const { text, tags } = splitTags(content);
  return { kind: "item", indent, item: { line, text, tags, fields: [], children: [] } };
}

function openField(match: RegExpExecArray, indent: string, line: number): Open & { kind: "field" } {
  const name = (match[1] ?? "").trim();
  const inline = (match[2] ?? "").trim();
  rejectDates(inline, line);
  const field: OutlineField = { line, name, values: inline === "" ? [] : [{ line, raw: inline }] };
  return { kind: "field", indent, field };
}

function parseLines(source: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  const fields: OutlineField[] = [];
  const stack: Open[] = [];
  let rootIndent: string | undefined;
  let seenContent = false;
  for (const [index, raw] of source.split(/\r?\n/).entries()) {
    const line = index + 1;
    if (raw.trim() === "") continue;
    if (raw.trim() === OUTLINE_HEADER) {
      if (seenContent) {
        throw new OutlineSyntaxError(line, `${OUTLINE_HEADER} may only be the first line`);
      }
      seenContent = true;
      continue;
    }
    seenContent = true;
    const indent = INDENT_RE.exec(raw)?.[0] ?? "";
    const body = raw.slice(indent.length).trimEnd();
    if (body !== "-" && !body.startsWith("- ")) {
      throw new OutlineSyntaxError(line, 'expected an item starting with "- "');
    }
    const content = body.slice(2);
    rootIndent ??= indent;
    const parent = placeLine(stack, indent, rootIndent, line);

    if (parent?.kind === "value") {
      throw new OutlineSyntaxError(line, "a field value cannot have children");
    }
    const fieldMatch = FIELD_RE.exec(content);
    if (parent?.kind === "field") {
      if (fieldMatch !== null) {
        throw new OutlineSyntaxError(line, "a field value cannot itself be a field");
      }
      const value = content.trim();
      if (value === "") throw new OutlineSyntaxError(line, "a field value cannot be empty");
      rejectDates(value, line);
      parent.field.values.push({ line, raw: value });
      stack.push({ kind: "value", indent });
      continue;
    }
    if (fieldMatch !== null) {
      if (parent === null) {
        throw new OutlineSyntaxError(line, "a field line needs an item above it to belong to");
      }
      const open = openField(fieldMatch, indent, line);
      parent.item.fields.push(open.field);
      fields.push(open.field);
      stack.push(open);
      continue;
    }
    const open = openItem(content, indent, line);
    (parent === null ? items : parent.item.children).push(open.item);
    stack.push(open);
  }
  const empty = fields.find((field) => field.values.length === 0);
  if (empty !== undefined) {
    throw new OutlineSyntaxError(empty.line, `field ${empty.name} has no value`);
  }
  return items;
}

/**
 * Read outline paste text into a tree of items, or say which line is wrong
 * and why. Blank lines are skipped; a line's indent (spaces, tabs, or both)
 * nests it under the nearest line above with a shorter indent that it
 * extends, and every child of one line shares one indent.
 */
export function parseOutline(source: string): OutlineParse {
  try {
    return { ok: true, items: parseLines(source) };
  } catch (err) {
    if (err instanceof OutlineSyntaxError)
      return { ok: false, line: err.line, reason: err.message };
    throw err;
  }
}

/** The field names an outline writes, in order of first appearance. */
export function outlineFieldNames(items: readonly OutlineItem[]): string[] {
  const names = new Set<string>();
  const walk = (list: readonly OutlineItem[]): void => {
    for (const item of list) {
      for (const field of item.fields) names.add(field.name);
      walk(item.children);
    }
  };
  walk(items);
  return [...names];
}
