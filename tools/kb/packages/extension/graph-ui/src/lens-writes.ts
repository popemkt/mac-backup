/**
 * The graph's writes to its view nodes, each through the page's host: an edit
 * through its write port (`browserHost().writes`), a new view node through
 * `proposeView`, so the graph names no shell module to write.
 */
import { browserHost, type PropValue, SYSTEM_IDS } from "@kb/ui-sdk";
import { rendererParamsOf, type LensPerspective, type RendererKey } from "@kb/graph";

/**
 * Persist one lens setting. The field is replaced whole in one write, so a
 * multi-valued append cannot accumulate (r10 §1.6).
 */
export const setLensProp = (perspectiveId: string, fieldId: string, value: PropValue) =>
  browserHost().writes.replaceField(perspectiveId, fieldId, [value]);

/** A graph view's renderer is its view: the option `sys.f.view` names. */
export const setGraphRenderer = (perspectiveId: string, renderer: string) =>
  browserHost().writes.replaceField(perspectiveId, SYSTEM_IDS.viewField, [
    { t: "ref", v: renderer },
  ]);

/**
 * Save `perspective` as a new graph view node of `renderer`: proposed as any
 * view node is (`view.propose`), with the params the renderer declares.
 */
export const saveGraphPerspective = (
  renderer: RendererKey<unknown>,
  perspective: LensPerspective,
  name: string,
) =>
  browserHost().proposeView({
    view: renderer,
    params: rendererParamsOf(renderer, perspective),
    text: name.trim() || "Graph perspective",
  });
