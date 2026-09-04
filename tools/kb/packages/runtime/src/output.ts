/**
 * The one process-output seam. CLI, MCP, registry, and the UI server write
 * here; `console.*` stays off everywhere else in backend packages.
 */
export function writeOut(text: string): void {
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
}

export function writeErr(text: string): void {
  process.stderr.write(text.endsWith("\n") ? text : `${text}\n`);
}
