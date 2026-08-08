import {
  SYSTEM_IDS,
  type KbNode,
  nowIso,
} from "./model.ts";

/** Reserved system nodes. Idempotent — same ids every time. */
export function systemSeedNodes(at: string = nowIso()): KbNode[] {
  const mk = (id: string, text: string, props: KbNode["props"] = {}): KbNode => ({
    id,
    text,
    props,
    children: [],
    createdAt: at,
    updatedAt: at,
  });

  const field = mk(SYSTEM_IDS.field, "sys.field");
  const tag = mk(SYSTEM_IDS.tag, "sys.tag");
  // sys.f.type and sys.f.fields are themselves fields (typed sys.field)
  const typeField = mk(SYSTEM_IDS.typeField, "type", {
    [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
  });
  const fieldsField = mk(SYSTEM_IDS.fieldsField, "fields", {
    [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
  });

  // Command type + palette command instances (W3)
  const command = mk(SYSTEM_IDS.command, "sys.command");
  const cmdType = {
    [SYSTEM_IDS.typeField]: [{ t: "ref" as const, v: SYSTEM_IDS.command }],
  };
  const commands: KbNode[] = [
    mk(SYSTEM_IDS.cmdAddNode, "Add node", cmdType),
    mk(SYSTEM_IDS.cmdAddTag, "Add tag", cmdType),
    mk(SYSTEM_IDS.cmdDefineField, "Define field", cmdType),
    mk(SYSTEM_IDS.cmdGoQuery, "Go to query page", cmdType),
    mk(SYSTEM_IDS.cmdNewQuery, "New query node", cmdType),
  ];

  return [field, tag, typeField, fieldsField, command, ...commands];
}

/** Merge seed into existing nodes without overwriting user edits to sys.* text/props. */
export function ensureSystemSeed(nodes: KbNode[]): {
  nodes: KbNode[];
  seeded: boolean;
} {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let seeded = false;
  for (const seed of systemSeedNodes()) {
    if (!byId.has(seed.id)) {
      byId.set(seed.id, seed);
      seeded = true;
    }
  }
  return { nodes: [...byId.values()], seeded };
}
