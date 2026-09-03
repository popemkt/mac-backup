/**
 * Example content for a freshly initialised store.
 *
 * A brand new kb is an empty outliner, which makes it impossible to try
 * anything without first building a schema by hand. These nodes exist so that
 * `kb init` lands somewhere you can immediately click: supertags with field
 * templates, one field of every type, an option list, refs, a live query, and
 * two ontologies where one inherits from the other.
 *
 * Three properties matter, and they are why this lives apart from the system
 * seed rather than inside it:
 *
 *   - They are ORDINARY nodes. Nothing here is `sys.*`, so none of it is
 *     write-guarded and all of it can be edited or deleted like anything else.
 *   - They are seeded ONCE, by the `init` surface, and only into a store with
 *     no content of its own. Opening a store never re-adds them, so deleting
 *     them makes them stay deleted.
 *   - They are not seeded by `openKb`, so no test fixture or library consumer
 *     inherits them.
 *
 * The `ex.` id prefix is deliberate: it makes every example node obvious in
 * `nodes.jsonl` and trivially greppable when clearing them out.
 */
import { fieldTypeValue } from "./field-type.ts";
import { SYSTEM_IDS, type KbNode, nowIso } from "./model.ts";
import { ranksFor } from "./order.ts";
import { systemSeedNodes } from "./seed.ts";

export const EXAMPLE_ID_PREFIX = "ex.";

export const EXAMPLE_IDS = {
  project: "ex.project",
  people: "ex.people",

  statusOptionTag: "ex.tag.status-option",
  statusTodo: "ex.status.todo",
  statusDoing: "ex.status.doing",
  statusDone: "ex.status.done",

  taskTag: "ex.tag.task",
  personTag: "ex.tag.person",

  statusField: "ex.f.status",
  dueField: "ex.f.due",
  estimateField: "ex.f.estimate",
  linkField: "ex.f.link",
  blockedField: "ex.f.blocked",
  ownerField: "ex.f.owner",

  ada: "ex.person.ada",
  linus: "ex.person.linus",

  task1: "ex.task.design",
  task2: "ex.task.review",
  task3: "ex.task.ship",

  note: "ex.note.inline",
  openTasks: "ex.query.open-tasks",

  ontoWork: "ex.onto.work",
  ontoActive: "ex.onto.active",
} as const;

/** Nodes tagged #task, which the query node and the Work ontology both use. */
export const EXAMPLE_OPEN_TASKS_EDN = `[:find ?id ?text
 :where [?n :f/${SYSTEM_IDS.typeField} ?t]
        [?t :node/id "${EXAMPLE_IDS.taskTag}"]
        [?n :node/id ?id]
        [?n :node/text ?text]]`;

export function exampleSeedNodes(at: string = nowIso()): KbNode[] {
  const mk = (
    id: string,
    text: string,
    props: KbNode["props"] = {},
    children: string[] = [],
  ): KbNode => ({ id, text, props, children, createdAt: at, updatedAt: at });

  const typed = (typeId: string) => ({
    [SYSTEM_IDS.typeField]: [{ t: "ref" as const, v: typeId }],
  });

  const tag = (id: string, text: string, fieldIds: string[] = [], children: string[] = []) =>
    mk(
      id,
      text,
      {
        ...typed(SYSTEM_IDS.tag),
        ...(fieldIds.length > 0
          ? {
              [SYSTEM_IDS.fieldsField]: fieldIds.map((v) => ({
                t: "ref" as const,
                v,
              })),
            }
          : {}),
      },
      children,
    );

  const field = (
    id: string,
    text: string,
    type: Parameters<typeof fieldTypeValue>[0],
    targetTag?: string,
  ) =>
    mk(id, text, {
      ...typed(SYSTEM_IDS.field),
      [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue(type)],
      ...(targetTag ? { [SYSTEM_IDS.targetTagField]: [{ t: "ref" as const, v: targetTag }] } : {}),
    });

  const nodes: KbNode[] = [
    // An option list is just tagged nodes, and a "field with options" is just a
    // ref field pointed at their tag. Add an option by adding a node.
    //
    // The options are children of the tag that defines the list, so they live
    // on its page instead of cluttering the top-level outline with three loose
    // rows — a tag node is not part of the outline forest, so its children are
    // reached by opening it.
    tag(
      EXAMPLE_IDS.statusOptionTag,
      "status-option",
      [],
      [EXAMPLE_IDS.statusTodo, EXAMPLE_IDS.statusDoing, EXAMPLE_IDS.statusDone],
    ),
    mk(EXAMPLE_IDS.statusTodo, "todo", typed(EXAMPLE_IDS.statusOptionTag)),
    mk(EXAMPLE_IDS.statusDoing, "doing", typed(EXAMPLE_IDS.statusOptionTag)),
    mk(EXAMPLE_IDS.statusDone, "done", typed(EXAMPLE_IDS.statusOptionTag)),

    // One field of every type, so each editor is reachable from the start.
    field(EXAMPLE_IDS.statusField, "status", "ref", EXAMPLE_IDS.statusOptionTag),
    field(EXAMPLE_IDS.dueField, "due", "date"),
    field(EXAMPLE_IDS.estimateField, "estimate", "number"),
    field(EXAMPLE_IDS.linkField, "link", "url"),
    field(EXAMPLE_IDS.blockedField, "blocked", "checkbox"),
    field(EXAMPLE_IDS.ownerField, "owner", "ref", EXAMPLE_IDS.personTag),

    // Supertags templating those fields onto whatever carries them.
    tag(EXAMPLE_IDS.taskTag, "task", [
      EXAMPLE_IDS.statusField,
      EXAMPLE_IDS.ownerField,
      EXAMPLE_IDS.dueField,
      EXAMPLE_IDS.estimateField,
      EXAMPLE_IDS.blockedField,
    ]),
    tag(EXAMPLE_IDS.personTag, "person", [EXAMPLE_IDS.linkField]),

    mk(EXAMPLE_IDS.people, "People", {}, [EXAMPLE_IDS.ada, EXAMPLE_IDS.linus]),
    mk(EXAMPLE_IDS.ada, "Ada", {
      ...typed(EXAMPLE_IDS.personTag),
      [EXAMPLE_IDS.linkField]: [{ t: "str", v: "https://en.wikipedia.org/wiki/Ada_Lovelace" }],
    }),
    mk(EXAMPLE_IDS.linus, "Linus", typed(EXAMPLE_IDS.personTag)),

    mk(EXAMPLE_IDS.project, "Example project", {}, [
      EXAMPLE_IDS.task1,
      EXAMPLE_IDS.task2,
      EXAMPLE_IDS.task3,
      EXAMPLE_IDS.note,
      EXAMPLE_IDS.openTasks,
    ]),
    mk(EXAMPLE_IDS.task1, "Draft the design doc", {
      ...typed(EXAMPLE_IDS.taskTag),
      [EXAMPLE_IDS.statusField]: [{ t: "ref", v: EXAMPLE_IDS.statusDoing }],
      [EXAMPLE_IDS.ownerField]: [{ t: "ref", v: EXAMPLE_IDS.ada }],
      [EXAMPLE_IDS.estimateField]: [{ t: "num", v: 3 }],
      [EXAMPLE_IDS.dueField]: [{ t: "str", v: "2026-09-01" }],
    }),
    // `[[id|label]]` in text is the ref form, and it is what puts an edge in
    // the graph and a row in the target's backlinks.
    mk(EXAMPLE_IDS.task2, `Review [[${EXAMPLE_IDS.task1}|the design doc]]`, {
      ...typed(EXAMPLE_IDS.taskTag),
      [EXAMPLE_IDS.statusField]: [{ t: "ref", v: EXAMPLE_IDS.statusTodo }],
      [EXAMPLE_IDS.ownerField]: [{ t: "ref", v: EXAMPLE_IDS.linus }],
      [EXAMPLE_IDS.blockedField]: [{ t: "bool", v: true }],
    }),
    mk(EXAMPLE_IDS.task3, "Ship it", {
      ...typed(EXAMPLE_IDS.taskTag),
      [EXAMPLE_IDS.statusField]: [{ t: "ref", v: EXAMPLE_IDS.statusDone }],
      [EXAMPLE_IDS.estimateField]: [{ t: "num", v: 1 }],
    }),
    mk(
      EXAMPLE_IDS.note,
      `Inline **markdown**, \`code\`, and refs like [[${EXAMPLE_IDS.taskTag}|#task]] all render in place.`,
    ),
    mk(EXAMPLE_IDS.openTasks, "Every task", {
      ...typed(SYSTEM_IDS.queryTag),
      [SYSTEM_IDS.queryField]: [{ t: "str", v: EXAMPLE_OPEN_TASKS_EDN }],
    }),

    /*
     * Two ontologies, because inheritance and veto are the parts worth seeing.
     * Work draws its members from two supertags plus one explicit pin; Active
     * inherits all of that and then vetoes one member. `exclude` is absolute —
     * it beats tag-, query-, extends- and closure-derived membership.
     */
    mk(EXAMPLE_IDS.ontoWork, "Work", {
      ...typed(SYSTEM_IDS.ontologyTag),
      [SYSTEM_IDS.ontoIncludeField]: [
        { t: "ref", v: EXAMPLE_IDS.taskTag },
        { t: "ref", v: EXAMPLE_IDS.personTag },
      ],
      [SYSTEM_IDS.ontoMemberField]: [{ t: "ref", v: EXAMPLE_IDS.note }],
    }),
    mk(EXAMPLE_IDS.ontoActive, "Active work", {
      ...typed(SYSTEM_IDS.ontologyTag),
      [SYSTEM_IDS.ontoExtendsField]: [{ t: "ref", v: EXAMPLE_IDS.ontoWork }],
      [SYSTEM_IDS.ontoExcludeField]: [{ t: "ref", v: EXAMPLE_IDS.task3 }],
    }),
  ];

  // Rank the roots so their order is explicit rather than left to the
  // open-time order migration to infer from ids.
  const childIds = new Set(nodes.flatMap((n) => n.children));
  const rootIds = nodes.filter((n) => !childIds.has(n.id)).map((n) => n.id);
  const ranks = ranksFor(rootIds);
  return nodes.map((n) => (ranks.has(n.id) ? { ...n, order: ranks.get(n.id)! } : n));
}

/**
 * True when a store holds nothing but its system seed, i.e. nobody has put
 * anything of their own in it yet. Example content is only ever added to such
 * a store, so re-running init can neither resurrect deleted examples nor bury
 * real notes under them.
 *
 * Derived from the seed rather than a hardcoded id list: the seed already owns
 * which ids it creates, including the non-`sys.` ones like the default graph
 * perspective, and a second list here would only drift out of step with it.
 */
export function isPristine(nodes: readonly { id: string }[]): boolean {
  const seeded = new Set(systemSeedNodes().map((n) => n.id));
  return nodes.every((n) => seeded.has(n.id));
}
