/**
 * A code view on a text surface: its code is not run here, so it is shown as
 * what it is — the code, the grant it would run under, and a note that it
 * runs only in the kb UI's sandbox (DESIGN.md → View nodes → Code views).
 * On a page, above that text, the figure is what the code draws as of the
 * render (DESIGN.md → Sandbox → Snapshots): run on the host's
 * `UntrustedEngine`, whatever this machine trusts, and calling actions only
 * through its `ReadInvoke`, because drawing a page is a read. A host that
 * binds neither, or a run that drew nothing, draws the text alone.
 *
 * The code view's text is contributed as its `ViewDef.text`, but it still
 * lives in core's operations: GAP [[01M41H2ZG7C0SV1DYZE6MMKPFE]]
 */
import { Effect } from "effect";
import { ReadInvoke, type KbContext, type ViewText } from "@kb/contracts";
import { UntrustedEngine, snapshotRun } from "@kb/sandbox";
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

/** What the code draws as of now, read-only, or null for nothing to show. */
const codeFigure = Effect.fn("code.figure")(function* (ctx: KbContext, params: CodeParams) {
  const engine = yield* UntrustedEngine;
  const invoke = yield* ReadInvoke;
  if (engine === null || invoke === null) return null;
  const { html, end } = yield* snapshotRun(
    engine,
    { invoke, node: (id) => ctx.index.getNode(id) },
    { code: params.code, grant: params.grant, subject: params.source ?? null },
  );
  const note = end === null ? "" : `<p><em>${escapeText(end.message)}</em></p>`;
  return html === null && note === "" ? null : `${html ?? ""}${note}`;
});

function escapeText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** A code view's body: a note on where it runs, its grant, and its code. */
function codeBody(_ctx: KbContext, params: CodeParams): readonly string[] {
  const fence = fenceFor(params.code);
  return [
    "",
    "## Code",
    "",
    "This view is code. It runs only in the kb UI, sandboxed: in QuickJS until a person trusts it on their machine, then in a Worker. As text it is shown, not run; a page shows what it draws as of now, run read-only.",
    "",
    `${grantLine(params)}${params.source === undefined ? "" : ` It is shown for ${params.source}.`}`,
    "",
    `${fence}js`,
    params.code,
    fence,
  ];
}

/** How a code view says itself in text: the code view's contribution of its `ViewDef.text`. */
export const codeText: ViewText<CodeParams> = { body: codeBody, figure: codeFigure };
