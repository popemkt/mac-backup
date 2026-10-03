import { lazy } from "react";
import { definePlugin } from "@kb/plugin";
import { CODE_NAMESPACE, CodeView, DEFAULT_GRANT } from "@kb/views";
import { ViewPoint, provideView } from "@/lib/plugins";

/** The code view's page, in a chunk of its own. */
const CodePage = lazy(() =>
  import("@/components/code/code-page").then((m) => ({ default: m.CodePage })),
);

/**
 * Code views (generative UI mode C): the `code.view` view, a view node's
 * code run in a sandbox frame. It owns no route: a node opens it through
 * `/node/<id>/<view>` like any view, in a pane, a dashboard or the pane
 * switcher.
 */
export const codeUiPlugin = definePlugin({
  name: CODE_NAMESPACE,
  apply: (ctx) =>
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
});
