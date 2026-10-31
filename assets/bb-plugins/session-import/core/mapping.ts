// Where an imported session's thread runs: which bb project, which machine, which directory. Pure
// (tests/core.test.ts); server.ts feeds it bb's projects and what the session's machine says about the cwd.

export interface ProjectSource {
  hostId: string;
  path: string;
  isDefault: boolean;
}

export interface ProjectInfo {
  id: string;
  name: string;
  gitRemoteUrl: string | null;
  sources: ProjectSource[];
}

export interface CwdFacts {
  /** The directory still exists on the session's machine. */
  exists: boolean;
  /** `git remote get-url origin` there, if any. */
  gitRemote: string | null;
}

/** The `environment` of bb's create-thread request, for the two shapes this plugin uses. */
export type ThreadEnvironment = {
  type: "host";
  hostId: string;
  workspace: { type: "unmanaged"; path: string | null };
};

export interface Target {
  projectId: string | null;
  projectName: string | null;
  /** How the project was found: its source contains the cwd, or its git remote matches the cwd's. */
  matchedBy: "source" | "remote" | "chosen" | null;
  hostId: string;
  /** The directory the thread runs in; null = the project's own source on that machine. */
  path: string | null;
  /** Why the thread does not run in the session's own directory, when it does not. */
  notes: string[];
}

/** github.com/owner/repo for https, ssh and scp-style remotes alike, so two spellings of one remote compare equal. */
export function normalizeRemote(url: string): string {
  return url
    .trim()
    .replace(/^[a-z+]+:\/\//i, "")
    .replace(/^[^@/]+@/, "")
    .replace(/:(?!\d)/, "/")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

const within = (dir: string, path: string) => path === dir || path.startsWith(dir.endsWith("/") ? dir : `${dir}/`);

/**
 * bb refuses an unmanaged workspace path inside its own data dir (`suppliedWorkspacePathRefusal`). Sessions that bb
 * threads ran there (its worktrees and personal workspaces) live under `.bb/`; such a thread continues in the
 * project's own source instead.
 */
export const isBbManagedPath = (path: string) => /\/\.bb(\/|$)/.test(path);

/** The project a session belongs to: its source on that machine contains the cwd (deepest wins), else its remote. */
export function matchProject(
  projects: ProjectInfo[],
  session: { hostId: string; cwd: string | null },
  facts: CwdFacts | null,
): { project: ProjectInfo; by: "source" | "remote" } | null {
  const cwd = session.cwd;
  if (cwd === null) return null;
  let best: { project: ProjectInfo; depth: number } | null = null;
  for (const p of projects) {
    for (const s of p.sources) {
      if (s.hostId !== session.hostId || !within(s.path, cwd)) continue;
      if (best === null || s.path.length > best.depth) best = { project: p, depth: s.path.length };
    }
  }
  // A source at the home directory contains everything; prefer a remote match over it.
  const remote = facts?.gitRemote ?? null;
  if (remote !== null) {
    const want = normalizeRemote(remote);
    const byRemote = projects.find(p => p.gitRemoteUrl !== null && normalizeRemote(p.gitRemoteUrl) === want);
    if (byRemote !== undefined && (best === null || best.project.gitRemoteUrl === null)) return { project: byRemote, by: "remote" };
  }
  return best === null ? null : { project: best.project, by: "source" };
}

/**
 * Where the thread runs. Default: the session's own machine and directory. On another machine, or when the
 * directory is gone or bb-managed, the project's source on the target machine.
 */
export function resolveTarget(args: {
  projects: ProjectInfo[];
  session: { hostId: string; cwd: string | null };
  facts: CwdFacts | null;
  targetHostId?: string;
  projectId?: string;
}): Target {
  const { projects, session, facts } = args;
  const hostId = args.targetHostId ?? session.hostId;
  const notes: string[] = [];
  const chosen = args.projectId === undefined ? null : (projects.find(p => p.id === args.projectId) ?? null);
  const matched = chosen === null ? matchProject(projects, session, facts) : { project: chosen, by: "chosen" as const };
  const project = matched?.project ?? null;
  const sourceThere = project?.sources.find(s => s.hostId === hostId) ?? null;
  const cwd = session.cwd;
  let path: string | null = null;
  if (hostId === session.hostId && cwd !== null) {
    if (facts !== null && !facts.exists) notes.push(`${cwd} no longer exists on that machine.`);
    else if (isBbManagedPath(cwd)) notes.push(`${cwd} is a bb-managed workspace; the thread uses the project's source instead.`);
    else path = cwd;
  } else if (hostId !== session.hostId) {
    notes.push("Another machine: the thread sees that machine's copy of the project, not uncommitted work from the session.");
  }
  if (path === null && project !== null && sourceThere === null) notes.push(`${project.name} has no source on that machine.`);
  if (project === null) notes.push("No bb project matches this session's directory: choose one.");
  return {
    projectId: project?.id ?? null,
    projectName: project?.name ?? null,
    matchedBy: matched?.by ?? null,
    hostId,
    path,
    notes,
  };
}

/** The create-thread environment for a target, or why there is none. */
export function environmentFor(target: Target, projects: ProjectInfo[]): ThreadEnvironment | { error: string } {
  if (target.projectId === null) return { error: "Choose a project for the thread." };
  if (target.path !== null) return { type: "host", hostId: target.hostId, workspace: { type: "unmanaged", path: target.path } };
  const project = projects.find(p => p.id === target.projectId);
  if (project === undefined || !project.sources.some(s => s.hostId === target.hostId)) {
    return { error: `${project?.name ?? target.projectId} has no source on that machine; pick another machine or project.` };
  }
  return { type: "host", hostId: target.hostId, workspace: { type: "unmanaged", path: null } };
}
