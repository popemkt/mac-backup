// AgentSpec files: JSON or YAML (one spec or a list), expanded into one validated spec per run.
// TypeScript specs are SDK scripts: they build the objects and hand them to `agentRun`, so no
// caller's code runs inside the bb server.
//
// Expansion substitutes each matrix combination's `${key}` into every string, then resolves the
// paths a spec names relative to the file that holds it: the workspace repo, the prompt file and
// file guides. A `{ dirs }` matrix value lists directories in the workspace repo at its ref, so a
// batch can be "one run per folder" without listing them.
import { execFile } from "node:child_process";
import { dirname, isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";
import { parse as parseYaml } from "yaml";
import { type AgentSpec, agentSpecSchema } from "../spec.ts";

const run = promisify(execFile);

/** At most this many runs in one batch. */
export const MAX_RUNS = 500;

export function parseSpecText(text: string): unknown[] {
  // YAML is a superset of JSON: one parser for both.
  const value: unknown = parseYaml(text);
  return Array.isArray(value) ? value : [value];
}

const substitute = (value: unknown, vars: Record<string, string>): unknown => {
  if (typeof value === "string") return value.replace(/\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (all, key: string) => vars[key] ?? all);
  if (Array.isArray(value)) return value.map((v) => substitute(v, vars));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, vars)]));
  }
  return value;
};

const combinations = (axes: Array<[string, string[]]>): Array<Record<string, string>> =>
  axes.reduce<Array<Record<string, string>>>(
    (acc, [key, values]) => acc.flatMap((combo) => values.map((value) => ({ ...combo, [key]: value }))),
    [{}],
  );

const absolute = (path: string, base: string) => (isAbsolute(path) ? path : resolve(base, path));

/** Directories at `path` in `repo` at `ref`. */
async function dirsAt(repo: string, ref: string, path: string): Promise<string[]> {
  const tree = `${ref}:${path.replace(/^\.?\/+|\/+$/g, "")}`;
  const { stdout } = await run("git", ["-C", repo, "ls-tree", "-d", "--name-only", tree], { maxBuffer: 4 * 1024 * 1024 });
  const dirs = stdout.split("\n").filter(Boolean);
  if (dirs.length === 0) throw new Error(`no directories at ${tree} in ${repo}`);
  return dirs;
}

/**
 * Every run `raw` declares, validated, with absolute paths. `baseDir` is the directory of the file
 * the spec came from (or the caller's cwd for an inline spec).
 */
export async function expandSpec(raw: unknown, baseDir: string): Promise<AgentSpec[]> {
  // Validate the template first, so a malformed spec fails with its own errors, not N copies.
  const template = agentSpecSchema.parse(raw);
  const repo = absolute(template.workspace.git.repo, baseDir);
  const axes: Array<[string, string[]]> = [];
  for (const [key, values] of Object.entries(template.matrix ?? {})) {
    axes.push([key, Array.isArray(values) ? values : await dirsAt(repo, template.workspace.git.ref, values.dirs)]);
  }
  const combos = combinations(axes);
  if (combos.length > MAX_RUNS) throw new Error(`the matrix makes ${combos.length} runs; at most ${MAX_RUNS} per batch`);
  const { matrix: _matrix, ...body } = raw as Record<string, unknown>;
  const specs: AgentSpec[] = [];
  const names = new Set<string>();
  for (const vars of combos) {
    const spec = agentSpecSchema.parse(substitute(body, vars));
    if (names.has(spec.name)) {
      throw new Error(`two runs are named ${spec.name}; put a matrix key (\${${Object.keys(vars)[0] ?? "key"}}) in the name`);
    }
    names.add(spec.name);
    spec.labels = { ...vars, ...spec.labels };
    spec.workspace.git.repo = absolute(spec.workspace.git.repo, baseDir);
    if (spec.instructions.promptFile) spec.instructions.promptFile = absolute(spec.instructions.promptFile, baseDir);
    spec.instructions.guides = spec.instructions.guides.map((g) => ("file" in g ? { ...g, file: absolute(g.file, baseDir) } : g));
    specs.push(spec);
  }
  return specs;
}

/** All runs in a spec file's text. */
export async function expandSpecText(text: string, path: string): Promise<AgentSpec[]> {
  const specs = [];
  for (const raw of parseSpecText(text)) specs.push(...(await expandSpec(raw, dirname(path))));
  if (specs.length > MAX_RUNS) throw new Error(`the file makes ${specs.length} runs; at most ${MAX_RUNS} per batch`);
  return specs;
}
