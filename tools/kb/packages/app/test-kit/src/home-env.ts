/**
 * A test's own home store (DESIGN.md → Locations). `KB_HOME` names where the
 * locations family keeps the person's home store; a test that needs one of its
 * own names it here and puts the previous one back after. An environment
 * variable cannot hold `undefined` (assigning it stores the string), so an
 * unset one is put back by deleting it.
 */

/** Point `KB_HOME` at `dir`; the returned function restores what was there. */
export function pointHomeAt(dir: string): () => void {
  // oxlint-disable-next-line node/no-process-env -- a test's home store is named by the environment, as the person's is
  const env = process.env;
  const previous = env.KB_HOME;
  env.KB_HOME = dir;
  return () => {
    if (previous === undefined) delete env.KB_HOME;
    else env.KB_HOME = previous;
  };
}
