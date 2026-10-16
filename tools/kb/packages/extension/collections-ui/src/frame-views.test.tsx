/**
 * A collection view is drawn only inside a frame's host, which hands it the
 * frame it lays out (`FrameSubject`); outside one it says there is no frame
 * to show, as the view contract asks of a family's view outside its host.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_VIEW_CONFIG } from "@kb/views";
import { BoardFrameView, CardsFrameView, TableFrameView } from "./frame-views";

const { filters, sort, display, colwidth, pagesize, groupFieldId } = DEFAULT_VIEW_CONFIG;
const host = { placement: "inline" as const };

describe("the collection views outside a frame's host", () => {
  it("each say there is no frame to show", () => {
    const shown = [
      createElement(TableFrameView, {
        params: { filters, sort, display, colwidth, pagesize },
        host,
      }),
      createElement(BoardFrameView, { params: { filters, sort, display, groupFieldId }, host }),
      createElement(CardsFrameView, { params: { filters, sort, display }, host }),
    ].map((element) => renderToStaticMarkup(element));
    for (const html of shown) expect(html).toContain('data-no-frame="true"');
  });
});
