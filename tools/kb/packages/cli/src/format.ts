import type { ActionReceipt } from "@kb/contracts";
import { isSysPrefixed } from "@kb/model";

export function formatReceipt(
  receipt: ActionReceipt,
  opts: { json: boolean; command?: string } = { json: false },
): string {
  if (opts.json) {
    return JSON.stringify(receipt, null, 2);
  }

  if (receipt.status === "failed") {
    const details =
      receipt.details !== undefined ? `\n${JSON.stringify(receipt.details, null, 2)}` : "";
    return `error [${receipt.code}] ${receipt.message}${details}`;
  }

  return formatSuccess(receipt.id, receipt.output, opts.command);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asObject(output: unknown): Record<string, unknown> | null {
  return isRecord(output) ? output : null;
}

function formatChildrenCommand(output: unknown): string | null {
  const obj = asObject(output);
  const node = obj?.node;
  if (
    typeof node !== "object" ||
    node === null ||
    !Array.isArray((node as { children?: unknown }).children)
  ) {
    return null;
  }
  return formatOutlineChildren(node as Record<string, unknown>);
}

function formatNodeGet(output: unknown): string {
  const node = asObject(output)?.node;
  return formatOutline(node, 0);
}

function formatGraphResult(output: unknown): string {
  return formatTable(asObject(output)?.rows);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function formatNodeAdd(output: unknown): string {
  const o = asObject(output);
  const node = o?.node;
  const text =
    typeof node === "object" &&
    node !== null &&
    typeof (node as { text?: unknown }).text === "string"
      ? (node as { text: string }).text
      : undefined;
  const suffix = text !== undefined && text !== "" ? `  ${text}` : "";
  return `added ${asString(o?.id)}${suffix}`;
}

function formatNodeUpdate(output: unknown): string {
  const o = asObject(output);
  if (o?.deleted === true) return `deleted ${asString(o.id)}`;
  return `updated ${asString(o?.id)}`;
}

function formatDefine(actionId: string, output: unknown): string {
  const kind = actionId.startsWith("field") ? "field" : "tag";
  return `defined ${kind} ${asString(asObject(output)?.id)}`;
}

function formatSuccess(actionId: string, output: unknown, command?: string): string {
  if (command === "children") {
    const formatted = formatChildrenCommand(output);
    if (formatted !== null) return formatted;
  }
  if (actionId === "node.get") return formatNodeGet(output);
  if (actionId === "graph.query" || actionId === "graph.run" || actionId === "graph.search") {
    return formatGraphResult(output);
  }
  if (actionId === "node.add") return formatNodeAdd(output);
  if (actionId === "node.update") return formatNodeUpdate(output);
  if (actionId === "field.define" || actionId === "tag.define")
    return formatDefine(actionId, output);
  return JSON.stringify(output, null, 2);
}

function formatOutline(node: unknown, depth: number): string {
  if (typeof node !== "object" || node === null) return String(node);
  const n = node as {
    id?: string;
    text?: string;
    missing?: boolean;
    children?: unknown[];
    props?: Record<string, unknown>;
  };
  if (n.missing === true) return `${"  ".repeat(depth)}- [${n.id}] (missing)`;
  const props =
    n.props !== undefined && Object.keys(n.props).length > 0 ? `  ${compactProps(n.props)}` : "";
  const lines = [`${"  ".repeat(depth)}- ${n.text ?? ""}  [${n.id ?? "?"}]${props}`];
  if (Array.isArray(n.children)) {
    for (const c of n.children) {
      lines.push(formatOutline(c, depth + 1));
    }
  }
  return lines.join("\n");
}

function formatOutlineChildren(node: Record<string, unknown>): string {
  const id = asString(node.id, "?");
  const text = asString(node.text);
  const kids = Array.isArray(node.children) ? node.children : [];
  const lines = [`${text}  [${id}]`];
  for (const c of kids) {
    if (typeof c === "object" && c !== null) {
      const child = c as { id?: string; text?: string; missing?: boolean };
      if (child.missing === true) lines.push(`  - [${asString(child.id)}] (missing)`);
      else lines.push(`  - ${asString(child.text)}  [${asString(child.id, "?")}]`);
    }
  }
  if (kids.length === 0) lines.push("  (no children)");
  return lines.join("\n");
}

function compactProps(props: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(props)) {
    parts.push(`${shortId(k)}=${JSON.stringify(v)}`);
  }
  return `{${parts.join(", ")}}`;
}

function shortId(id: string): string {
  if (isSysPrefixed(id)) return id;
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function formatTable(rows: unknown): string {
  if (!Array.isArray(rows)) return String(rows);
  if (rows.length === 0) return "(no rows)";
  const asRows = rows.map((r) => (Array.isArray(r) ? r : [r]));
  const widths: number[] = [];
  for (const row of asRows) {
    row.forEach((cell, i) => {
      const s = cellString(cell);
      widths[i] = Math.max(widths[i] ?? 0, s.length);
    });
  }
  return asRows
    .map((row) => row.map((cell, i) => cellString(cell).padEnd(widths[i] ?? 0)).join("  "))
    .join("\n");
}

function cellString(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "string") return cell;
  return JSON.stringify(cell);
}
