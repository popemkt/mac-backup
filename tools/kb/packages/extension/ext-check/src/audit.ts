import { isAbsolute, relative, resolve, sep } from "node:path";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { KbCtx } from "@kb/contracts";
import {
  SURFACE_FILES,
  auditOutput,
  buildCheckModel,
  checkSurfaceSchema,
  derivedEnforcement,
  isCheck,
  propRefs,
  propText,
  propValues,
  type Finding,
  type CheckModel,
} from "./model.ts";

function pathInRoot(root: string, candidate: string | undefined): string | undefined {
  if (candidate === undefined || candidate === "" || isAbsolute(candidate)) return undefined;
  const rootPath = resolve(root);
  const path = resolve(rootPath, candidate);
  const rel = relative(rootPath, path);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
  return path;
}

const isFile = Effect.fn("ext.check.isFile")(function* (path: string | undefined) {
  if (path === undefined) return false;
  const fs = yield* FileSystem;
  if (!(yield* fs.exists(path).pipe(Effect.orElseSucceed(() => false)))) return false;
  return yield* fs.stat(path).pipe(
    Effect.map((info) => info.type === "File"),
    Effect.orElseSucceed(() => false),
  );
});

const surfaceFiles = Effect.fn("ext.check.surfaceFiles")(function* (
  root: string,
  surface: keyof typeof SURFACE_FILES,
) {
  const fs = yield* FileSystem;
  const files = new Set<string>();
  for (const pattern of SURFACE_FILES[surface]) {
    const wildcard = pattern.indexOf("*");
    if (wildcard < 0) {
      const path = pathInRoot(root, pattern);
      if (path !== undefined && (yield* isFile(path))) files.add(path);
      continue;
    }

    const separator = pattern.lastIndexOf("/", wildcard);
    const directory = pathInRoot(root, separator < 0 ? "." : pattern.slice(0, separator));
    const basename = pattern.slice(separator + 1);
    const [prefix, suffix, extra] = basename.split("*");
    if (
      directory === undefined ||
      prefix === undefined ||
      suffix === undefined ||
      extra !== undefined
    ) {
      continue;
    }
    const entries = yield* fs
      .readDirectory(directory)
      .pipe(Effect.orElseSucceed((): string[] => []));
    for (const entry of entries) {
      if (!entry.startsWith(prefix) || !entry.endsWith(suffix)) continue;
      const path = pathInRoot(
        root,
        `${separator < 0 ? "" : pattern.slice(0, separator + 1)}${entry}`,
      );
      if (path !== undefined && (yield* isFile(path))) files.add(path);
    }
  }
  return [...files].toSorted();
});

const invocationIsWired = Effect.fn("ext.check.invocationIsWired")(function* (
  root: string,
  surface: string | undefined,
  invocation: string | undefined,
) {
  const parsed = checkSurfaceSchema.safeParse(surface);
  if (!parsed.success || invocation === undefined || invocation === "") return false;
  const fs = yield* FileSystem;
  const files = yield* surfaceFiles(root, parsed.data);
  for (const path of files) {
    const content = yield* fs.readFileString(path).pipe(Effect.orElseSucceed(() => ""));
    if (content.includes(invocation)) return true;
  }
  return false;
});

function githubHeadingSlug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}\s-]/gu, "")
    .replaceAll(/\s/g, "-");
}

function headingSlugs(markdown: string): Set<string> {
  const slugs = new Set<string>();
  for (const line of markdown.split("\n")) {
    const match = /^(?:#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    const heading = match?.[1];
    if (heading !== undefined) slugs.add(githubHeadingSlug(heading));
  }
  return slugs;
}

const homeIsValid = Effect.fn("ext.check.homeIsValid")(function* (
  root: string,
  home: string | undefined,
) {
  if (home === undefined || home === "") return false;
  const hash = home.lastIndexOf("#");
  const pathText = hash < 0 ? home : home.slice(0, hash);
  const anchor = hash < 0 ? undefined : home.slice(hash + 1);
  const path = pathInRoot(root, pathText);
  if (!(yield* isFile(path))) return false;
  if (anchor === undefined) return true;
  if (anchor === "" || path === undefined || !pathText.toLowerCase().endsWith(".md")) return false;
  const fs = yield* FileSystem;
  const markdown = yield* fs.readFileString(path).pipe(Effect.orElseSucceed(() => ""));
  return headingSlugs(markdown).has(anchor);
});

function findCheckMissing(model: CheckModel): Finding[] {
  const checkMissing: Finding[] = [];
  for (const rule of model.rules) {
    for (const check of propRefs(model, rule, "check")) {
      if (!isCheck(model, check)) {
        checkMissing.push({
          kind: "check-missing",
          rule: rule.id,
          check,
          message: `rule ${rule.id} references ${check}, which is not tagged check`,
        });
      }
    }
  }
  return checkMissing;
}

const findEvidenceMissing = Effect.fn("ext.check.findEvidenceMissing")(function* (
  root: string,
  model: CheckModel,
) {
  const evidenceMissing: Finding[] = [];
  for (const check of model.checks) {
    const evidence = propText(model, check, "evidence");
    if (!(yield* isFile(pathInRoot(root, evidence)))) {
      evidenceMissing.push({
        kind: "evidence-missing",
        check: check.id,
        message: `check ${check.id} evidence is not a repo file: ${evidence ?? "(missing)"}`,
      });
    }
  }
  return evidenceMissing;
});

const findInvocationUnwired = Effect.fn("ext.check.findInvocationUnwired")(function* (
  root: string,
  model: CheckModel,
) {
  const invocationUnwired: Finding[] = [];
  for (const check of model.checks) {
    const surface = propText(model, check, "surface");
    const invocation = propText(model, check, "invocation");
    if (!(yield* invocationIsWired(root, surface, invocation))) {
      invocationUnwired.push({
        kind: "invocation-unwired",
        check: check.id,
        message: `check ${check.id} invocation is not wired on ${surface ?? "(missing)"}: ${invocation ?? "(missing)"}`,
      });
    }
  }
  return invocationUnwired;
});

function findEnforcementStale(model: CheckModel): Finding[] {
  const enforcementStale: Finding[] = [];
  for (const rule of model.rules) {
    const derived = derivedEnforcement(model, rule);
    const stored = propText(model, rule, "enforcement");
    if (derived.value === undefined || stored !== derived.value) {
      enforcementStale.push({
        kind: "enforcement-stale",
        rule: rule.id,
        ...(derived.check === undefined ? {} : { check: derived.check }),
        message: `rule ${rule.id} enforcement is ${stored ?? "(missing)"}; expected ${derived.value ?? "one shared check surface"}`,
      });
    }
  }
  return enforcementStale;
}

function findGateAndCheck(model: CheckModel): Finding[] {
  const gateAndCheck: Finding[] = [];
  for (const rule of model.rules) {
    const checks = propRefs(model, rule, "check");
    if (checks.length > 0 && propValues(model, rule, "gate").length > 0) {
      gateAndCheck.push({
        kind: "gate-and-check",
        rule: rule.id,
        check: checks[0] ?? "",
        message: `rule ${rule.id} carries both gate and check`,
      });
    }
  }
  return gateAndCheck;
}

const findHomeBroken = Effect.fn("ext.check.findHomeBroken")(function* (
  root: string,
  model: CheckModel,
) {
  const homeBroken: Finding[] = [];
  for (const rule of model.rules) {
    const home = propText(model, rule, "home");
    if (!(yield* homeIsValid(root, home))) {
      homeBroken.push({
        kind: "home-broken",
        rule: rule.id,
        message: `rule ${rule.id} home does not resolve: ${home ?? "(missing)"}`,
      });
    }
  }
  return homeBroken;
});

export const checkAuditEffect = Effect.fn("ext.check.audit")(function* (_input: object) {
  const ctx = yield* KbCtx;
  const model = buildCheckModel(ctx.nodes);
  const checkMissing = findCheckMissing(model);
  const evidenceMissing = yield* findEvidenceMissing(ctx.root, model);
  const invocationUnwired = yield* findInvocationUnwired(ctx.root, model);
  const enforcementStale = findEnforcementStale(model);
  const gateAndCheck = findGateAndCheck(model);
  const homeBroken = yield* findHomeBroken(ctx.root, model);

  const findings = [
    ...checkMissing,
    ...evidenceMissing,
    ...invocationUnwired,
    ...enforcementStale,
    ...gateAndCheck,
    ...homeBroken,
  ];
  return auditOutput.parse({ clean: findings.length === 0, findings });
});
