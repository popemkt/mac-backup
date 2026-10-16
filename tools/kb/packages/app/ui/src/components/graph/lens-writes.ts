/**
 * The graph's writes to its view nodes, each through the page's write port
 * (`browserHost().writes`), so the graph names no shell module to write.
 */
import { browserHost, type PropValue, SYSTEM_IDS } from "@kb/ui-sdk";
import { perspectiveProps, type LensPerspective } from "@kb/views";

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

/** Save `perspective` as a new graph view node, filed in the Views list. */
export const saveGraphPerspective = (perspective: LensPerspective, name: string) =>
  browserHost().writes.addViewNode(
    name.trim() || "Graph perspective",
    perspectiveProps(perspective),
  );
