/**
 * The grammar of a workspace name: letters, digits, `_`, `.` and `-`, starting
 * on a word character. It is stated here, in the domain, because a stored
 * thing is named by it (a docs view node's name, which `render.view` and the
 * `ui://kb/view/<name>` resources address) as well as a workspace file (a
 * saved query), and the ports in `@kb/contracts` re-export it rather than
 * keep a copy.
 *
 * Rejects traversal, separators, spaces, control characters, leading dots and
 * dashes, and the empty string. Matches what `kb run` has always accepted.
 */
const WORKSPACE_NAME_RE = /^[\w][\w.-]*$/;

export function isValidWorkspaceName(name: string): boolean {
  return typeof name === "string" && WORKSPACE_NAME_RE.test(name);
}
