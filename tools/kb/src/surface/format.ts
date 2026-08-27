import type { ActionReceipt } from "../shared/contracts.ts";
import { isSysPrefixed } from "../foundation/model.ts";

export function formatReceipt(
  receipt: ActionReceipt,
  opts: { json: boolean; command?: string } = { json: false },
): string {
  if (opts.json) {
    return JSON.stringify(receipt, null, 2);
  }

  if (receipt.status === "failed") {
    const details =
      receipt.details !== undefined
        ? `\n${JSON.stringify(receipt.details, null, 2)}`
        : "";
    return `error [${receipt.code}] ${receipt.message}${details}`;
  }

  return formatSuccess(receipt.id, receipt.output, opts.command);
}

function formatSuccess(
  actionId: string,
  output: unknown,
  command?: string,
): string {
  if (command === "children" && output && typeof output === "object") {
    const node = (output as { node?: Record<string, unknown> }).node;
    if (node && Array.isArray(node.children)) {
      return formatOutlineChildren(node);
    }
  }

  if (actionId === "node.get" && output && typeof output === "object") {
    const node = (output as { node?: unknown }).node;
    return formatOutline(node, 0);
  }

  if (
    (actionId === "graph.query" ||
      actionId === "graph.run" ||
      actionId === "graph.search") &&
    output &&
    typeof output === "object"
  ) {
    const rows = (output as { rows?: unknown }).rows;
    return formatTable(rows);
  }

  if (actionId === "node.add" && output && typeof output === "object") {
    const o = output as { id?: string; node?: { text?: string } };
    return `added ${o.id}${o.node?.text ? `  ${o.node.text}` : ""}`;
  }

  if (actionId === "node.update" && output && typeof output === "object") {
    const o = output as { id?: string; deleted?: boolean };
    if (o.deleted) return `deleted ${o.id}`;
    return `updated ${o.id}`;
  }

  if (
    (actionId === "field.define" || actionId === "tag.define") &&
    output &&
    typeof output === "object"
  ) {
    const o = output as { id?: string };
    return `defined ${actionId.startsWith("field") ? "field" : "tag"} ${o.id}`;
  }

  return JSON.stringify(output, null, 2);
}

function formatOutline(node: unknown, depth: number): string {
  if (!node || typeof node !== "object") return String(node);
  const n = node as {
    id?: string;
    text?: string;
    missing?: boolean;
    children?: unknown[];
    props?: Record<string, unknown>;
  };
  if (n.missing) return `${"  ".repeat(depth)}- [${n.id}] (missing)`;
  const props =
    n.props && Object.keys(n.props).length > 0
      ? `  ${compactProps(n.props)}`
      : "";
  const lines = [
    `${"  ".repeat(depth)}- ${n.text ?? ""}  [${n.id ?? "?"}]${props}`,
  ];
  if (Array.isArray(n.children)) {
    for (const c of n.children) {
      lines.push(formatOutline(c, depth + 1));
    }
  }
  return lines.join("\n");
}

function formatOutlineChildren(node: Record<string, unknown>): string {
  const id = node.id ?? "?";
  const text = node.text ?? "";
  const kids = Array.isArray(node.children) ? node.children : [];
  const lines = [`${text}  [${id}]`];
  for (const c of kids) {
    if (c && typeof c === "object") {
      const child = c as { id?: string; text?: string; missing?: boolean };
      if (child.missing) lines.push(`  - [${child.id}] (missing)`);
      else lines.push(`  - ${child.text ?? ""}  [${child.id ?? "?"}]`);
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
    .map((row) =>
      row
        .map((cell, i) => cellString(cell).padEnd(widths[i] ?? 0))
        .join("  "),
    )
    .join("\n");
}

function cellString(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "string") return cell;
  return JSON.stringify(cell);
}
