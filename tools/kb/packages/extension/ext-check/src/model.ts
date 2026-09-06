import type { KbNode, NodeId, PropValue } from "@kb/model";
import { z } from "zod";

/**
 * The surfaces a check can live on: every enforcement level except `prose`,
 * which by definition means "nothing checks it". The `surface` field says the
 * same thing as data — its `sys.f.targetQuery` selects the `enforcement`
 * field's children minus that one — so the picker and this list are two
 * readings of one declaration rather than two hand-kept copies.
 */
const CHECK_SURFACES = ["harness", "lint", "tsc", "hook", "ci"] as const;
export const checkSurfaceSchema = z.enum(CHECK_SURFACES);
export type CheckSurface = z.infer<typeof checkSurfaceSchema>;

export const SURFACE_FILES: Record<CheckSurface, readonly string[]> = {
  harness: ["tools/kb/package.json"],
  lint: ["tools/kb/.oxlintrc.json"],
  tsc: ["tools/kb/tsconfig.base.json"],
  hook: [".githooks/pre-commit"],
  ci: [".github/workflows/*.yml"],
};

const checkMissing = z.object({
  kind: z.literal("check-missing"),
  rule: z.string(),
  check: z.string(),
  message: z.string(),
});
const evidenceMissing = z.object({
  kind: z.literal("evidence-missing"),
  check: z.string(),
  message: z.string(),
});
const invocationUnwired = z.object({
  kind: z.literal("invocation-unwired"),
  check: z.string(),
  message: z.string(),
});
const enforcementStale = z.object({
  kind: z.literal("enforcement-stale"),
  rule: z.string(),
  check: z.string().optional(),
  message: z.string(),
});
const gateAndCheck = z.object({
  kind: z.literal("gate-and-check"),
  rule: z.string(),
  check: z.string(),
  message: z.string(),
});
const homeBroken = z.object({
  kind: z.literal("home-broken"),
  rule: z.string(),
  message: z.string(),
});

export const findingSchema = z.discriminatedUnion("kind", [
  checkMissing,
  evidenceMissing,
  invocationUnwired,
  enforcementStale,
  gateAndCheck,
  homeBroken,
]);
export type Finding = z.infer<typeof findingSchema>;

export const auditOutput = z.object({
  clean: z.boolean(),
  findings: z.array(findingSchema),
});

export const syncOutput = z.object({
  updated: z.array(z.string()),
});

export interface CheckModel {
  readonly nodesById: ReadonlyMap<NodeId, KbNode>;
  readonly rules: readonly KbNode[];
  readonly checks: readonly KbNode[];
  readonly fieldIds: ReadonlyMap<string, NodeId>;
  readonly enforcementIds: ReadonlyMap<string, NodeId>;
  readonly checkTagIds: ReadonlySet<NodeId>;
}

function refs(values: readonly PropValue[] | undefined): NodeId[] {
  return (values ?? []).flatMap((value) => (value.t === "ref" ? [value.v] : []));
}

function typeRefs(node: KbNode): NodeId[] {
  return refs(node.props["sys.f.type"]);
}

function tagIdsNamed(nodes: readonly KbNode[], name: string): Set<NodeId> {
  return new Set(
    nodes
      .filter((node) => node.text === name && typeRefs(node).includes("sys.tag"))
      .map((node) => node.id),
  );
}

function tagged(nodes: readonly KbNode[], tagIds: ReadonlySet<NodeId>): KbNode[] {
  return nodes.filter((node) => typeRefs(node).some((id) => tagIds.has(id)));
}

/**
 * The option set a field declares by parenting it: its children, in order.
 *
 * `prose`, `lint`, `tsc`, `harness`, `hook`, `ci` are not kinds of thing — they
 * are the values `enforcement` may take — so they are children of that field
 * and carry no supertag (DESIGN → Kinds, roles and options). The
 * `#enforcement-level` tag this replaces existed only to give a `targetTag`
 * something to point at.
 */
function fieldOptions(
  nodesById: ReadonlyMap<NodeId, KbNode>,
  fieldId: NodeId | undefined,
): KbNode[] {
  const field = fieldId === undefined ? undefined : nodesById.get(fieldId);
  return (field?.children ?? []).flatMap((id) => {
    const child = nodesById.get(id);
    return child === undefined ? [] : [child];
  });
}

export function buildCheckModel(nodes: readonly KbNode[]): CheckModel {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const fieldIds = new Map<string, NodeId>();
  for (const node of nodes) {
    if (typeRefs(node).includes("sys.field") && !fieldIds.has(node.text)) {
      fieldIds.set(node.text, node.id);
    }
  }

  const checkTagIds = tagIdsNamed(nodes, "check");
  const enforcementIds = new Map<string, NodeId>();
  for (const option of fieldOptions(nodesById, fieldIds.get("enforcement"))) {
    enforcementIds.set(option.text, option.id);
  }

  return {
    nodesById,
    rules: tagged(nodes, tagIdsNamed(nodes, "rule")).toSorted((a, b) => a.id.localeCompare(b.id)),
    checks: tagged(nodes, checkTagIds).toSorted((a, b) => a.id.localeCompare(b.id)),
    fieldIds,
    enforcementIds,
    checkTagIds,
  };
}

export function propValues(model: CheckModel, node: KbNode, field: string): readonly PropValue[] {
  const fieldId = model.fieldIds.get(field);
  return fieldId === undefined ? [] : (node.props[fieldId] ?? []);
}

export function propRefs(model: CheckModel, node: KbNode, field: string): NodeId[] {
  return refs(propValues(model, node, field));
}

export function propText(model: CheckModel, node: KbNode, field: string): string | undefined {
  const value = propValues(model, node, field)[0];
  if (value === undefined) return undefined;
  return value.t === "ref" ? model.nodesById.get(value.v)?.text : String(value.v);
}

export function isCheck(model: CheckModel, id: NodeId): boolean {
  const node = model.nodesById.get(id);
  return node !== undefined && typeRefs(node).some((tag) => model.checkTagIds.has(tag));
}

export function derivedEnforcement(
  model: CheckModel,
  rule: KbNode,
): { readonly check?: NodeId; readonly value?: string } {
  const checkIds = propRefs(model, rule, "check");
  if (checkIds.length === 0) return { value: "prose" };

  const surfaces = checkIds.flatMap((id) => {
    const check = model.nodesById.get(id);
    const surface = check === undefined ? undefined : propText(model, check, "surface");
    return surface === undefined ? [] : [surface];
  });
  const unique = new Set(surfaces);
  return {
    check: checkIds[0],
    value: surfaces.length === checkIds.length && unique.size === 1 ? surfaces[0] : undefined,
  };
}
