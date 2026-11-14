// Which agent tools each role gets. One table, read twice: by `agents.configure` (what a session
// is offered) and by every tool's execute (what a call is allowed), because configuration is
// fixed when a session starts and the role may have changed since.
import { type Role, type RoleMeta, ROLE_LABEL } from "./model.ts";

export const TOOLS = {
  projectChief: "cm_project_chief",
  handoff: "cm_handoff",
  roster: "cm_roster",
  reportUp: "cm_report_up",
  adopt: "cm_adopt",
} as const;
export type ToolName = (typeof TOOLS)[keyof typeof TOOLS];

const TABLE: Record<Role, readonly ToolName[]> = {
  coordinator: [TOOLS.projectChief, TOOLS.handoff, TOOLS.roster, TOOLS.adopt],
  "project-chief": [TOOLS.handoff, TOOLS.roster, TOOLS.reportUp, TOOLS.adopt],
  architect: [TOOLS.roster, TOOLS.reportUp],
};

export const toolsFor = (role: Role | null): readonly ToolName[] => (role === null ? [] : TABLE[role]);

export const allows = (role: Role | null, tool: ToolName): boolean => toolsFor(role).includes(tool);

/** The refusal a tool returns when the calling thread's role does not carry it. */
export function refusal(tool: ToolName, meta: RoleMeta | null): string {
  const who = meta === null ? "this thread has no chief-mode role" : `this thread is a ${ROLE_LABEL[meta.role].toLowerCase()}`;
  const holders = (Object.keys(TABLE) as Role[]).filter((role) => TABLE[role].includes(tool)).map((role) => ROLE_LABEL[role].toLowerCase());
  return `${tool} is for a ${holders.join(" or ")}; ${who}. Adopt a role first with \`bb chief-mode adopt <thread> --role …\`.`;
}

/**
 * The dynamic instructions for a roled thread. Values come from metadata anyone can write, so
 * they are JSON-quoted to read as data.
 */
export function roleInstructions(meta: RoleMeta, names: { project: string | null; reportsToTitle: string | null }): string {
  const lines = [`chief-mode: this thread is the ${ROLE_LABEL[meta.role].toLowerCase()} in the Chief hierarchy (follow the chief-mode skill).`];
  if (meta.projectId !== null) lines.push(`Project (data): ${JSON.stringify(names.project ?? meta.projectId)} ${JSON.stringify(meta.projectId)}`);
  if (meta.taskKey !== null) lines.push(`Task (data): ${JSON.stringify(meta.taskKey)}`);
  if (meta.reportsTo !== null) {
    lines.push(
      `Reports to thread (data): ${JSON.stringify(meta.reportsTo)}${names.reportsToTitle === null ? "" : ` ${JSON.stringify(names.reportsToTitle)}`}.`,
      meta.autoReport
        ? "Your final message of each turn is sent up automatically when you go idle; end turns with a short status (done / blocked / needs decision)."
        : "Automatic report-up is off for this thread; use cm_report_up to report.",
    );
  }
  lines.push(`Tools: ${toolsFor(meta.role).join(", ")}.`);
  return lines.join("\n");
}
