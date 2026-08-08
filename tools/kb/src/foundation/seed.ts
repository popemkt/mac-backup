import {
  SYSTEM_IDS,
  type KbNode,
  nowIso,
} from "./model.ts";

/** Four reserved system nodes. Idempotent — same ids every time. */
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

  return [field, tag, typeField, fieldsField];
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
