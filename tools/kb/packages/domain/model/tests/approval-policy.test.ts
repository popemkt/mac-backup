/**
 * `#approval-policy` nodes as the resolver reads them, and the defaults the
 * seed writes (DESIGN.md → Action registry → Approval).
 */
import { describe, expect, test } from "bun:test";
import {
  ACTOR_OPTION_IDS,
  DECISION_OPTION_IDS,
  approvalPoliciesOf,
  approvalPolicyNode,
} from "../src/approval-policy.ts";
import { SYSTEM_IDS, type KbNode } from "../src/model.ts";
import { systemSeedNodes } from "../src/seed.ts";

const node = (id: string, props: KbNode["props"] = {}): KbNode => ({
  id,
  text: id,
  props,
  children: [],
  createdAt: "",
  updatedAt: "",
});

describe("approval policies", () => {
  test("a policy is read from its tag and fields; an absent actor is every actor", () => {
    const agent = approvalPolicyNode(node("p.agent"), {
      match: "node.delete",
      actor: "agent",
      decision: "ask",
    });
    const anyone = approvalPolicyNode(node("p.anyone"), {
      match: " ext.* ",
      actor: null,
      decision: "deny",
    });
    expect(approvalPoliciesOf([agent, anyone])).toEqual([
      { id: "p.agent", match: "node.delete", actor: "agent", decision: "ask" },
      { id: "p.anyone", match: "ext.*", actor: null, decision: "deny" },
    ]);
  });

  test("a half-written policy decides nothing, and an untagged node is no policy", () => {
    const tag = {
      [SYSTEM_IDS.typeField]: [{ t: "ref" as const, v: SYSTEM_IDS.approvalPolicyTag }],
    };
    const decision = {
      [SYSTEM_IDS.approvalDecisionField]: [{ t: "ref" as const, v: DECISION_OPTION_IDS.deny }],
    };
    const match = { [SYSTEM_IDS.approvalMatchField]: [{ t: "str" as const, v: "node.add" }] };
    const nodes = [
      node("no.match", { ...tag, ...decision }),
      node("no.decision", { ...tag, ...match }),
      node("bad.actor", {
        ...tag,
        ...match,
        ...decision,
        [SYSTEM_IDS.approvalActorField]: [{ t: "ref", v: "n.someone" }],
      }),
      node("untagged", { ...match, ...decision }),
    ];
    expect(approvalPoliciesOf(nodes)).toEqual([]);
  });

  test("the seed tags its vocabulary as options and asks an agent before a delete or a rewrite", () => {
    const seed = systemSeedNodes();
    const byId = new Map(seed.map((seeded) => [seeded.id, seeded]));
    expect(byId.get(SYSTEM_IDS.approvalActorField)?.children).toEqual(
      Object.values(ACTOR_OPTION_IDS),
    );
    expect(byId.get(SYSTEM_IDS.approvalDecisionField)?.children).toEqual(
      Object.values(DECISION_OPTION_IDS),
    );
    const policies = approvalPoliciesOf(seed);
    expect(policies.map(({ match, actor, decision }) => ({ match, actor, decision }))).toEqual([
      { match: "node.delete", actor: "agent", decision: "ask" },
      { match: "views.migrate", actor: "agent", decision: "ask" },
    ]);
    // Filed under the query node that lists every policy, and editable.
    expect(byId.get(SYSTEM_IDS.approvalPolicies)?.children).toEqual(policies.map((p) => p.id));
    expect(policies.every((p) => !p.id.startsWith("sys."))).toBe(true);
  });
});
