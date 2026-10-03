/**
 * A code view on a text surface: its code is not run here, so it is shown as
 * what it is — the code, the grant it would run under, and a note that it
 * runs only in the kb UI's sandbox (DESIGN.md → View nodes → Code views).
 */
import type { CodeParams } from "@kb/views";

/** A fence long enough that no run of backticks in `code` closes it. */
function fenceFor(code: string): string {
  const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((run) => run[0].length));
  return "`".repeat(longest + 1);
}

/** What the grant lets the code ask, in one line. */
function grantLine({ grant }: CodeParams): string {
  const actions = grant.actions.length === 0 ? "no other action" : grant.actions.join(", ");
  return `It may read ${grant.reads === "none" ? "nothing" : `its ${grant.reads}`}, and call ${actions}.`;
}

/** A code view's body: a note on where it runs, its grant, and its code. */
export function codeBody(params: CodeParams): { readonly lines: readonly string[] } {
  const fence = fenceFor(params.code);
  return {
    lines: [
      "",
      "## Code",
      "",
      "This view is code. It runs only in the kb UI, sandboxed: in QuickJS until a person trusts it on their machine, then in a Worker. Here it is shown, not run.",
      "",
      `${grantLine(params)}${params.source === undefined ? "" : ` It is shown for ${params.source}.`}`,
      "",
      `${fence}js`,
      params.code,
      fence,
    ],
  };
}
