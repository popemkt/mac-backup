import { readFileSync } from "node:fs";
import { join } from "node:path";
import { allWorkspaceTsFiles } from "./scopes.ts";
import { WORKSPACE_ROOT } from "./workspace.ts";

const SUPPRESSION = /\/\/\s*(?:oxlint|eslint)-disable-(?:next-)?line\b/;
const OXLINT_NEXT_LINE = /^\s*\/\/ oxlint-disable-next-line (\S+) -- (\S(?:.*\S)?)\s*$/;
const GAP_REASON = /^GAP \[\[[^\]]+\]\]$/;

export function suppressionViolation(line: string): string | undefined {
  if (!SUPPRESSION.test(line)) return undefined;
  const match = OXLINT_NEXT_LINE.exec(line);
  if (match === null) return "must use the oxlint-disable-next-line rule -- reason form";
  const reason = match[2];
  if (reason?.startsWith("GAP") === true && !GAP_REASON.test(reason)) {
    return "a GAP reason must be exactly GAP [[id]]";
  }
  return undefined;
}

export function repositorySuppressionViolations(root: string = WORKSPACE_ROOT): string[] {
  const violations: string[] = [];
  for (const file of allWorkspaceTsFiles(root)) {
    const lines = readFileSync(join(root, file), "utf8").split("\n");
    for (const [index, line] of lines.entries()) {
      const violation = suppressionViolation(line);
      if (violation !== undefined) violations.push(`${file}:${index + 1}: ${violation}`);
    }
  }
  return violations;
}
