/**
 * Mermaid flowchart text read as a diagram (DESIGN.md → Canvas documents →
 * Diagram): a second parser into the one spec a query's nodes also make
 * (`diagramDoc` draws both). Its header gives the flow; each statement
 * names boxes, with a shape and words, and the links among them, with a
 * label, heads and a line. A box shape kb has no equivalent for is drawn as
 * its nearest; a statement kb reads nothing of (a subgraph, a class, a
 * style, a click) is reported with its line, never dropped silently.
 */
import type { DiagramBox, DiagramFlow, DiagramLink, DiagramSpec } from "./diagram.ts";
import type { CanvasHead } from "./doc.ts";
import type { CanvasPresetKind } from "./presets.ts";
import { CanvasRelationError } from "./relations.ts";
import type { CanvasLooksPatch } from "./style.ts";

/** What did not come across, by the line it is on. */
export interface MermaidReport {
  readonly line: number;
  readonly note: string;
}

export interface MermaidDiagram {
  readonly spec: DiagramSpec;
  readonly reported: readonly MermaidReport[];
}

const FLOWS: Readonly<Record<string, DiagramFlow>> = {
  TD: "down",
  TB: "down",
  BT: "up",
  LR: "right",
  RL: "left",
};

/** A box shape as mermaid writes it, the kb shape it is drawn as, and whether that is only its nearest. */
interface MermaidShape {
  readonly name: string;
  readonly open: string;
  readonly close: readonly string[];
  readonly shape: Extract<CanvasPresetKind, "rect" | "ellipse" | "diamond">;
  readonly nearest: boolean;
}

/** Longest opener first, so `((` is never read as `(`. */
const SHAPES: readonly MermaidShape[] = [
  { name: "double circle", open: "(((", close: [")))"], shape: "ellipse", nearest: true },
  { name: "circle", open: "((", close: ["))"], shape: "ellipse", nearest: false },
  { name: "stadium", open: "([", close: ["])"], shape: "rect", nearest: true },
  { name: "subroutine", open: "[[", close: ["]]"], shape: "rect", nearest: true },
  { name: "cylinder", open: "[(", close: [")]"], shape: "rect", nearest: true },
  { name: "hexagon", open: "{{", close: ["}}"], shape: "diamond", nearest: true },
  { name: "trapezoid", open: "[/", close: ["/]", "\\]"], shape: "rect", nearest: true },
  { name: "trapezoid", open: "[\\", close: ["\\]", "/]"], shape: "rect", nearest: true },
  { name: "rectangle", open: "[", close: ["]"], shape: "rect", nearest: false },
  { name: "rounded box", open: "(", close: [")"], shape: "rect", nearest: false },
  { name: "rhombus", open: "{", close: ["}"], shape: "diamond", nearest: false },
  { name: "flag", open: ">", close: ["]"], shape: "rect", nearest: true },
];

/** Statements kb draws nothing for, by their first word. */
const UNREAD = new Set([
  "subgraph",
  "end",
  "direction",
  "classDef",
  "class",
  "style",
  "linkStyle",
  "click",
  "accTitle",
  "accDescr",
]);

/*
 * Every pattern is sticky (`y`) and read in place at a position
 * (`stickyAt`), never on a slice of what is left, so reading a statement
 * is linear in its length.
 */
const ID = /[\p{L}\p{N}_$]+/uy;
const SPACE = /\s*/y;
const CLASSED = /:::[\w-]+/y;
const AMP = /\s*&/y;
/** How a link with its label between its halves opens, up to its label's first character: `-- `, `-. `, `== `. */
const LINK_OPEN = /\s*([<ox])?(--|==|-\.)\s+(?=[^\s=.-])/uy;
/** How such a link closes, after the space that ends its label: `-->`, `.->`, `==>`. */
const LINK_CLOSE = /(-{2,}|={2,}|\.-+)(>|[ox](?![\p{L}\p{N}_]))?/uy;
/** A link written whole, its label (if any) after it between bars: `-->`, `-.->|maybe|`, `<==>`. */
const LINK_WHOLE = /\s*([<ox])?(-{2,}|={2,}|-\.+-)(>|[ox](?![\p{L}\p{N}_]))?(?:\s*\|([^|]*)\|)?/uy;
/** A run of space, found from a position onward. */
const SPACE_RUN = /\s+/gu;

/** `pattern` (sticky or global) matched in `text` from `at`. */
function stickyAt(pattern: RegExp, text: string, at: number): RegExpExecArray | null {
  pattern.lastIndex = at;
  return pattern.exec(text);
}

/** A head as mermaid writes it, at the far end and at the near end. */
const FAR_HEADS: Readonly<Record<string, CanvasHead | null | undefined>> = {
  ">": undefined,
  o: "dot",
  x: "bar",
};
const NEAR_HEADS: Readonly<Record<string, CanvasHead | undefined>> = {
  "<": "arrow",
  o: "dot",
  x: "bar",
};

interface ReadBox {
  readonly key: string;
  readonly label?: string;
  readonly form?: MermaidShape;
}

/** A link as read, before its ends are known. */
type ReadLink = Omit<DiagramLink, "from" | "to"> & { readonly crossed: boolean };

/** What one statement says, or why it could not be read. */
interface Statement {
  readonly boxes: readonly ReadBox[];
  readonly links: readonly DiagramLink[];
  readonly notes: readonly string[];
}

const unquoted = (text: string): string => {
  const trimmed = text.trim();
  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1)
    : trimmed;
};

/** The words inside a box's shape from `at`, and where they end: quoted words may hold its closer. */
function boxWords(
  text: string,
  at: number,
  form: MermaidShape,
): { label: string; at: number } | null {
  const from = text[at] === '"' ? text.indexOf('"', at + 1) + 1 : at;
  if (from === 0) return null;
  const ends = form.close.flatMap((close) => {
    const i = text.indexOf(close, from);
    return i === -1 ? [] : [{ i, close }];
  });
  const end = ends.toSorted((a, b) => a.i - b.i)[0];
  if (end === undefined) return null;
  return { label: unquoted(text.slice(at, end.i)), at: end.i + end.close.length };
}

/** The box at `at`, its shape and words if it says them, and where it ends. */
function readBox(
  text: string,
  start: number,
): { box: ReadBox; at: number; notes: string[] } | null {
  const lead = stickyAt(SPACE, text, start)?.[0].length ?? 0;
  const id = stickyAt(ID, text, start + lead)?.[0];
  if (id === undefined) return null;
  let at = start + lead + id.length;
  const notes: string[] = [];
  const form = SHAPES.find((shape) => text.startsWith(shape.open, at));
  let box: ReadBox = { key: id };
  if (form !== undefined) {
    const words = boxWords(text, at + form.open.length, form);
    if (words === null) return null;
    box = { key: id, label: words.label, form };
    at = words.at;
    if (form.nearest) notes.push(`${id}'s ${form.name} is drawn as a ${form.shape}`);
  }
  const classed = stickyAt(CLASSED, text, at)?.[0];
  if (classed !== undefined) {
    notes.push(`kb reads no class: ${id}'s ${classed.slice(3)} is not drawn`);
    at += classed.length;
  }
  return { box, at, notes };
}

/** The boxes at `at` joined by `&`, and where they end. */
function readGroup(
  text: string,
  start: number,
): { boxes: ReadBox[]; at: number; notes: string[] } | null {
  const boxes: ReadBox[] = [];
  const notes: string[] = [];
  let at = start;
  for (;;) {
    const read = readBox(text, at);
    if (read === null) return null;
    boxes.push(read.box);
    notes.push(...read.notes);
    at = read.at;
    const amp = stickyAt(AMP, text, at);
    if (amp === null) return { boxes, at, notes };
    at += amp[0].length;
  }
}

/** The look a link's line says: dotted is dashed, thick is heavy. */
function lineLooks(body: string): CanvasLooksPatch | undefined {
  if (body.includes(".")) return { dash: "dashed" };
  if (body.startsWith("=")) return { size: "l" };
  return undefined;
}

/** A link's parts as written: its near head, its line, its label, its far head, and where it ends. */
interface LinkParts {
  readonly near: string;
  readonly body: string;
  readonly label: string | undefined;
  readonly far: string;
  readonly end: number;
}

/** A link written whole at `at`, its label (if any) after it between bars. */
function wholeLink(text: string, at: number): LinkParts | null {
  const whole = stickyAt(LINK_WHOLE, text, at);
  if (whole === null) return null;
  return {
    near: whole[1] ?? "",
    body: whole[2] ?? "",
    far: whole[3] ?? "",
    label: whole[4],
    end: at + whole[0].length,
  };
}

/** One statement being read: its text, and from where on no labelled link can close. */
interface Reading {
  readonly text: string;
  /** A position from which no space is followed by a closer: a labelled link opening there or after never closes. */
  closerless: number;
}

/**
 * A link with its label between its halves at `at`: the label runs to the
 * first space a closer follows. Found by one pass over the runs of space,
 * and a pass that finds none marks where none can be found again.
 */
function splitLink(reading: Reading, at: number): LinkParts | null {
  const { text } = reading;
  const open = stickyAt(LINK_OPEN, text, at);
  if (open === null) return null;
  const from = at + open[0].length;
  if (from >= reading.closerless) return null;
  for (let run = stickyAt(SPACE_RUN, text, from); run !== null; run = SPACE_RUN.exec(text)) {
    const after = run.index + run[0].length;
    const close = stickyAt(LINK_CLOSE, text, after);
    if (close !== null) {
      return {
        near: open[1] ?? "",
        body: open[2] ?? "",
        label: text.slice(from, run.index),
        far: close[2] ?? "",
        end: after + close[0].length,
      };
    }
    SPACE_RUN.lastIndex = after;
  }
  reading.closerless = from;
  return null;
}

/** The link at `at`, and where it ends. */
function readLink(reading: Reading, at: number): { link: ReadLink; at: number } | null {
  const parts = splitLink(reading, at) ?? wholeLink(reading.text, at);
  if (parts === null) return null;
  const { near, body, far, label, end } = parts;
  const looks = lineLooks(body);
  const fromHead = NEAR_HEADS[near];
  const toHead = far === "" ? null : FAR_HEADS[far];
  return {
    at: end,
    link: {
      crossed: near === "x" || far === "x",
      ...(label === undefined || unquoted(label) === "" ? {} : { label: unquoted(label) }),
      ...(fromHead === undefined ? {} : { fromHead }),
      ...(toHead === undefined ? {} : { toHead }),
      ...(looks === undefined ? {} : { style: looks }),
    },
  };
}

/** One statement: boxes, and the links between each group and the next. */
function readStatement(text: string): Statement | null {
  const reading: Reading = { text, closerless: text.length + 1 };
  const first = readGroup(text, 0);
  if (first === null) return null;
  const boxes = [...first.boxes];
  const links: DiagramLink[] = [];
  const notes = [...first.notes];
  let group = first;
  for (;;) {
    const read = readLink(reading, group.at);
    if (read === null) break;
    const next = readGroup(text, read.at);
    if (next === null) return null;
    const { crossed, ...link } = read.link;
    if (crossed) notes.push("kb has no cross head: it is drawn as a bar");
    for (const from of group.boxes)
      for (const to of next.boxes) links.push({ ...link, from: from.key, to: to.key });
    boxes.push(...next.boxes);
    notes.push(...next.notes);
    group = next;
  }
  return text.slice(group.at).trim() === "" ? { boxes, links, notes } : null;
}

/** Each line's statements, split at `;` outside quotes, with the line each is on. */
function statementsOf(lines: readonly string[]): { line: number; text: string }[] {
  return lines.flatMap((raw, i) => {
    const parts: string[] = [];
    let quoted = false;
    let from = 0;
    for (let at = 0; at < raw.length; at++) {
      if (raw[at] === '"') quoted = !quoted;
      if (raw[at] === ";" && !quoted) {
        parts.push(raw.slice(from, at));
        from = at + 1;
      }
    }
    parts.push(raw.slice(from));
    return parts
      .map((text) => ({ line: i + 1, text: text.trim() }))
      .filter((part) => part.text !== "" && !part.text.startsWith("%%"));
  });
}

/** The lines after any front matter (`---` … `---`) at the top. */
function bodyLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() !== "");
  if (lines[start]?.trim() !== "---") return lines;
  const end = lines.findIndex((line, i) => i > start && line.trim() === "---");
  return end === -1 ? lines : lines.map((line, i) => (i <= end ? "" : line));
}

/** Every box once, in the order first named, with the last words and shape said for it. */
function collectBoxes(read: readonly ReadBox[]): Map<string, ReadBox> {
  const boxes = new Map<string, ReadBox>();
  for (const box of read) {
    const known = boxes.get(box.key);
    boxes.set(box.key, box.form === undefined && known !== undefined ? known : box);
  }
  return boxes;
}

/**
 * The diagram mermaid flowchart `text` draws, and what in it was not drawn.
 * Throws `CanvasRelationError` for text that is no flowchart (its first
 * statement is not `flowchart` or `graph`, with an optional TD, TB, BT, LR
 * or RL) or that names no box.
 */
export function mermaidDiagram(text: string): MermaidDiagram {
  const [header, ...statements] = statementsOf(bodyLines(text));
  const heading = /^(?:flowchart|graph)(?:\s+(\w+))?$/i.exec(header?.text ?? "");
  if (heading === null) {
    throw new CanvasRelationError("kb reads a mermaid flowchart: flowchart (or graph) TD, LR, …");
  }
  const flow = FLOWS[(heading[1] ?? "TD").toUpperCase()];
  if (flow === undefined)
    throw new CanvasRelationError(`a flowchart runs TD, TB, BT, LR or RL, not ${heading[1]}`);
  const reported: MermaidReport[] = [];
  const read: ReadBox[] = [];
  const links: DiagramLink[] = [];
  for (const { line, text: statement } of statements) {
    const word = /^\S+/.exec(statement)?.[0] ?? "";
    if (UNREAD.has(word)) {
      if (word !== "end") reported.push({ line, note: `kb draws no ${word}` });
      continue;
    }
    const said = readStatement(statement);
    if (said === null) {
      reported.push({ line, note: `kb could not read it: ${statement}` });
      continue;
    }
    read.push(...said.boxes);
    reported.push(...said.notes.map((note) => ({ line, note })));
    for (const link of said.links) {
      if (link.from === link.to)
        reported.push({ line, note: `${link.from} links to itself: not drawn` });
      else links.push(link);
    }
  }
  const boxes = collectBoxes(read);
  if (boxes.size === 0) throw new CanvasRelationError("the flowchart names no box");
  return {
    spec: {
      flow,
      links,
      boxes: [...boxes.values()].map(
        (box): DiagramBox => ({
          key: box.key,
          item: { preset: box.form?.shape ?? "rect", text: box.label ?? box.key },
        }),
      ),
    },
    reported,
  };
}
