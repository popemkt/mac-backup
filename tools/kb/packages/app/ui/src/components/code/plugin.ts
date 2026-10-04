import { lazy } from "react";
import { Effect } from "effect";
import { CodeView, DEFAULT_GRANT, codeExtension, codePlugin } from "@kb/code";
import { definePlugin } from "@kb/plugin";
import { BrowserHostService, provideView, ViewPoint } from "@kb/ui-sdk";

/** The code view's page, in a chunk of its own. */
const CodePage = lazy(() =>
  import("@/components/code/code-page").then((m) => ({ default: m.CodePage })),
);

/**
 * Code views (generative UI mode C): the `code.view` view, a view node's
 * code run in a sandbox frame. It owns no route: a node opens it through
 * `/node/<id>/<view>` like any view, in a pane, a dashboard or the pane
 * switcher.
 *
 * It is the code family's page entry, so it loads the family's shared plugin
 * as a child: the code view's key reaches the page kernel's catalog from the
 * family, as the server's does, and with no engine bound on the page its
 * isomorphic actions show a code view as its text.
 */
export const codeUiPlugin = definePlugin({
  name: codeExtension.name,
  inject: [BrowserHostService],
  apply: (ctx) =>
    Effect.all(
      [
        ctx.plugin(codePlugin()),
        ctx.contribute(
          ViewPoint,
          provideView(CodeView, {
            placements: ["page"],
            sample: {
              source: "n.root-a",
              code: 'kb.draw(["p", {}, kb.subject]);',
              grant: DEFAULT_GRANT,
            },
            Component: CodePage,
          }),
        ),
      ],
      { discard: true },
    ),
});
