/**
 * The bundled seed fold (DESIGN.md → Extension families → the seed is the
 * bundled fold): each declared view's option is derived from its key, in
 * declaration order, as is each declared option's under its kind's field
 * (a backdrop's under `sys.f.backdrop`, a design system's under
 * `sys.f.design-system`) and each declared policy's under the list of every
 * policy (a denial only),
 * `sys.views` names the default view type, and an id two declarations claim
 * is refused.
 */
import { describe, expect, test } from "bun:test";
import {
  BACKDROP_OPTIONS,
  DESIGN_SYSTEM_OPTIONS,
  SYSTEM_IDS,
  VIEW_FAMILY_VALUES,
  approvalPoliciesOf,
  declaredOptionId,
  defaultViewTypeOf,
  extensionNodeId,
  foldSeed,
  viewOptionId,
} from "@kb/model";
import type { ExtensionDeclaration } from "@kb/contracts";
import { BUNDLED_DECLARATIONS, bundledOwners, bundledSeed } from "@kb/bundled";

const AT = "2026-01-01T00:00:00.000Z";
const declaredKeys = BUNDLED_DECLARATIONS.flatMap((declaration) =>
  (declaration.views ?? []).map((view) => view.key),
);

/** Each kind of declared option, and where a declaration lists its things. */
const DECLARED_KINDS = [
  { kind: BACKDROP_OPTIONS, of: (declaration: ExtensionDeclaration) => declaration.backdrops },
  {
    kind: DESIGN_SYSTEM_OPTIONS,
    of: (declaration: ExtensionDeclaration) => declaration.designSystems,
  },
];

/** The option nodes `declaration` owns, of every declared kind. */
const declaredOptionsOf = (declaration: ExtensionDeclaration) =>
  DECLARED_KINDS.flatMap(({ kind, of }) =>
    (of(declaration) ?? []).map((option) => declaredOptionId(kind, option.id)),
  );

describe("bundled seed", () => {
  test("sys.views lists one option per declared view, in declaration order", () => {
    const seed = new Map(bundledSeed(AT).map((node) => [node.id, node]));
    expect(seed.get(SYSTEM_IDS.viewsRoot)?.children).toEqual(
      declaredKeys.map((key) => viewOptionId(key.id)),
    );
  });

  test("each option carries its key's label and its key's family", () => {
    const seed = new Map(bundledSeed(AT).map((node) => [node.id, node]));
    for (const key of declaredKeys) {
      const option = seed.get(key.option);
      expect(option?.text).toBe(key.label);
      const family = option?.props[SYSTEM_IDS.viewFamilyField]?.[0];
      expect(family?.v).toBe(
        key.family === undefined ? undefined : VIEW_FAMILY_VALUES[key.family].id,
      );
    }
  });

  test.each(DECLARED_KINDS)(
    "$kind.field lists one option per declared thing, labelled, in declaration order",
    ({ kind, of }) => {
      const seed = new Map(bundledSeed(AT).map((node) => [node.id, node]));
      const declared = BUNDLED_DECLARATIONS.flatMap((declaration) => of(declaration) ?? []);
      expect(declared.length).toBeGreaterThan(0);
      expect(seed.get(kind.field)?.children).toEqual(
        declared.map((option) => declaredOptionId(kind, option.id)),
      );
      for (const option of declared) {
        expect(seed.get(declaredOptionId(kind, option.id))?.text).toBe(option.label);
      }
    },
  );

  test("sys.views names the default view type: a declared view's option, the outline's", () => {
    const seed = new Map(bundledSeed(AT).map((node) => [node.id, node]));
    const named = defaultViewTypeOf(seed.get(SYSTEM_IDS.viewsRoot)) ?? "none";
    expect(declaredKeys.map((key) => key.option)).toContain(named);
    // The id is frozen data: whichever declaration provides the outline, it is this one.
    expect(named).toBe(viewOptionId("outline.main"));
  });

  test("a declared policy is filed with every policy, and one that does not deny is refused", () => {
    const seed = new Map(bundledSeed(AT).map((node) => [node.id, node]));
    const declared = BUNDLED_DECLARATIONS.flatMap((declaration) => declaration.policies ?? []);
    expect(declared.length).toBeGreaterThan(0);
    for (const policy of declared) {
      expect(seed.get(SYSTEM_IDS.approvalPolicies)?.children).toContain(policy.id);
      expect(approvalPoliciesOf([...seed.values()])).toContainEqual(
        expect.objectContaining({ id: policy.id, decision: "deny" }),
      );
    }
    const permits = {
      name: "lenient",
      label: "Lenient",
      policies: [{ id: "p.allow", text: "allows", match: "*", actor: null, decision: "allow" }],
    };
    expect(() =>
      foldSeed(
        [...BUNDLED_DECLARATIONS, permits as unknown as (typeof BUNDLED_DECLARATIONS)[number]],
        AT,
      ),
    ).toThrow("which does not deny");
  });

  test("an id two declarations claim is refused", () => {
    expect(() => foldSeed([...BUNDLED_DECLARATIONS, ...BUNDLED_DECLARATIONS], AT)).toThrow(
      /declared twice/,
    );
  });

  test("every node it seeds has one owner, the declaration it came from", () => {
    const owners = bundledOwners();
    expect([...owners.keys()].toSorted()).toEqual(
      bundledSeed(AT)
        .map((node) => node.id)
        .toSorted(),
    );
    for (const declaration of BUNDLED_DECLARATIONS) {
      const owned = [
        ...(declaration.seed?.(AT) ?? []).map((node) => node.id),
        ...(declaration.views ?? []).map((view) => viewOptionId(view.key.id)),
        ...declaredOptionsOf(declaration),
        ...(declaration.policies ?? []).map((policy) => policy.id),
        extensionNodeId(declaration.name),
      ];
      expect(owned.map((id) => [id, owners.get(id)])).toEqual(
        owned.map((id) => [id, declaration.name]),
      );
    }
  });

  test("it is pure data: the same nodes every time", () => {
    expect(bundledSeed(AT)).toEqual(bundledSeed(AT));
  });
});
