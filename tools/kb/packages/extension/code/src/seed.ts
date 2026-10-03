/**
 * The code family's seed: the two fields a code view node keeps its code and
 * its grant in, both text and run as stored, declared the way core declares
 * its own fields. The bundled seed folds it after core's nodes (DESIGN.md →
 * Extension families → the seed is the bundled fold).
 */
import { seededField, type KbNode } from "@kb/model";
import { CODE_IDS } from "./ids.ts";

export function codeSeedNodes(at: string): readonly KbNode[] {
  return [
    seededField(CODE_IDS.codeField, "code", "text", at, { one: true }),
    seededField(CODE_IDS.codeGrantField, "code.grant", "text", at, { one: true }),
  ];
}
