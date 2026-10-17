/**
 * The code family's seed: the two fields a code view node or a script keeps
 * its code and its grant in, both text and run as stored; the `#script` tag
 * over them, which configures the family (`sys.f.configures`), so minting or
 * editing a script is configuration — an agent is asked, a script is
 * refused; and `sys.f.scripts`, which names a node's scripts. Declared the
 * way core declares its own. The bundled seed folds it after core's nodes
 * (DESIGN.md → Extension families → the seed is the bundled fold).
 */
import { SYSTEM_IDS, extensionNodeId, seededField, seededTag, type KbNode } from "@kb/model";
import { CODE_IDS } from "./ids.ts";

export function codeSeedNodes(at: string): readonly KbNode[] {
  const tag = seededTag(
    CODE_IDS.scriptTag,
    "script",
    [CODE_IDS.codeField, CODE_IDS.codeGrantField],
    at,
  );
  return [
    seededField(CODE_IDS.codeField, "code", "text", at, { one: true }),
    seededField(CODE_IDS.codeGrantField, "code.grant", "text", at, { one: true }),
    {
      ...tag,
      props: {
        ...tag.props,
        [SYSTEM_IDS.configuresField]: [{ t: "ref", v: extensionNodeId("code") }],
      },
    },
    seededField(CODE_IDS.scriptsField, "scripts", "ref", at, {
      props: { [SYSTEM_IDS.targetTagField]: [{ t: "ref", v: CODE_IDS.scriptTag }] },
    }),
  ];
}
