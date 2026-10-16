/**
 * A view node's subject, as every view stores it: the node it draws
 * (`lens.focus`) and the query that selects its nodes (`lens.query`). The
 * fields are named for the graph's lens, where they began, but they are
 * every view's: an outline, a layout, a chart and a code view are rooted by
 * `lens.focus`, and a docs view and `render.view` read `lens.query`. The
 * graph's lens (`@kb/graph`'s `lens.ts`) decodes them through these same
 * slots.
 */
import { Schema } from "effect";
import {
  SYSTEM_IDS,
  encodeNodeConfig,
  firstRef,
  firstStr,
  oneOf,
  writeRef,
  writeStr,
  type ConfigSlots,
  type NodeProps,
  type PropValue,
} from "@kb/model";

/** What a view node says of what it draws. */
interface ViewSubject {
  /** EDN datalog → node id set; empty/absent = all nodes. */
  query: string;
  /** The node it is rooted at, when it names one; else the node it is shown for. */
  focus: string | null;
}

/** The subject's slots: one statement of each field, its reading and its default. */
export const SUBJECT_SLOTS: ConfigSlots<ViewSubject> = {
  query: oneOf({
    fields: [SYSTEM_IDS.lensQueryField],
    read: firstStr(SYSTEM_IDS.lensQueryField),
    write: writeStr(SYSTEM_IDS.lensQueryField),
    schema: Schema.String,
    fallback: "",
  }),
  focus: oneOf<string | null>({
    fields: [SYSTEM_IDS.lensFocusField],
    read: firstRef(SYSTEM_IDS.lensFocusField),
    write: writeRef(SYSTEM_IDS.lensFocusField),
    schema: Schema.String,
    fallback: null,
  }),
};

/**
 * The node a view draws: the node its `lens.focus` names, else the node it
 * is shown for (`host`), else none.
 */
export function subjectRootOf(props: NodeProps, host: string | null): string | undefined {
  return firstRef(SYSTEM_IDS.lensFocusField)(props) ?? host ?? undefined;
}

/** The props a view node stores its root as: its `lens.focus`. */
export function subjectRootProps(root: string): Record<string, PropValue[]> {
  return encodeNodeConfig(SUBJECT_SLOTS, { focus: root });
}
